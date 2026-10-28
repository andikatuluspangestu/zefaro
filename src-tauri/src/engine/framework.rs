//! What a site's folder holds: Laravel, Symfony, WordPress and so on, from
//! its composer.json and the files each framework always has. The Sites page
//! shows it next to the site's name.

use serde_json::Value;
use std::fs;
use std::path::Path;

/// Composer packages that identify a framework, checked in order: Statamic
/// and Craft before Laravel and Symfony, which they're built on.
const PACKAGES: &[(&str, &str)] = &[
    ("statamic/cms", "statamic"),
    ("craftcms/cms", "craft"),
    ("laravel/lumen-framework", "lumen"),
    ("laravel/framework", "laravel"),
    ("drupal/core", "drupal"),
    ("drupal/core-recommended", "drupal"),
    ("magento/framework", "magento"),
    ("magento/product-community-edition", "magento"),
    ("contao/core-bundle", "contao"),
    ("contao/manager-bundle", "contao"),
    ("roots/wordpress", "wordpress"),
    ("johnpbloch/wordpress", "wordpress"),
    ("codeigniter4/framework", "codeigniter"),
    ("cakephp/cakephp", "cakephp"),
    ("yiisoft/yii2", "yii"),
    ("laminas/laminas-mvc", "laminas"),
    ("slim/slim", "slim"),
    ("symfony/framework-bundle", "symfony"),
];

/// Files a framework always has, for projects installed without Composer.
const FILES: &[(&str, &str)] = &[
    ("wp-load.php", "wordpress"),
    ("public/wp-load.php", "wordpress"),
    ("web/wp/wp-load.php", "wordpress"),
    ("core/lib/Drupal.php", "drupal"),
    ("web/core/lib/Drupal.php", "drupal"),
    ("bin/magento", "magento"),
    ("system/CodeIgniter.php", "codeigniter"),
    ("libraries/src/Factory.php", "joomla"),
    ("artisan", "laravel"),
    ("bin/console", "symfony"),
];

/// The framework id ("laravel", "wordpress", …), "php" for other PHP
/// projects, "static" for plain HTML, None when the folder is empty or gone.
pub fn detect(dir: &Path) -> Option<&'static str> {
    if let Ok(text) = fs::read_to_string(dir.join("composer.json")) {
        if let Ok(json) = serde_json::from_str::<Value>(&text) {
            let has = |name: &str| {
                ["require", "require-dev"].iter().any(|k| json.get(k).and_then(|r| r.get(name)).is_some())
                    || json.get("name").and_then(Value::as_str) == Some(name)
            };
            if let Some((_, id)) = PACKAGES.iter().find(|(package, _)| has(package)) {
                return Some(id);
            }
        }
    }
    if let Some((_, id)) = FILES.iter().find(|(file, _)| dir.join(file).is_file()) {
        return Some(id);
    }
    let root = if dir.join("public").is_dir() { dir.join("public") } else { dir.to_path_buf() };
    if dir.join("composer.json").is_file() || root.join("index.php").is_file() {
        Some("php")
    } else if root.join("index.html").is_file() {
        Some("static")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zefaro-framework-{name}"));
        let _ = fs::remove_dir_all(&dir);
        for (file, text) in files {
            let path = dir.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn recognises_frameworks() {
        let cases: &[(&str, &[(&str, &str)], Option<&str>)] = &[
            ("laravel", &[("composer.json", r#"{"require":{"laravel/framework":"^12.0"}}"#), ("artisan", "")], Some("laravel")),
            ("statamic", &[("composer.json", r#"{"require":{"laravel/framework":"^12.0","statamic/cms":"^5"}}"#)], Some("statamic")),
            ("symfony", &[("composer.json", r#"{"require":{"symfony/framework-bundle":"7.*"}}"#)], Some("symfony")),
            ("bedrock", &[("composer.json", r#"{"require":{"roots/wordpress":"^6"}}"#)], Some("wordpress")),
            ("wordpress", &[("wp-load.php", "<?php"), ("index.php", "<?php")], Some("wordpress")),
            ("drupal", &[("core/lib/Drupal.php", "<?php")], Some("drupal")),
            ("joomla", &[("libraries/src/Factory.php", "<?php")], Some("joomla")),
            ("plain", &[("public/index.php", "<?php")], Some("php")),
            ("html", &[("index.html", "<p>")], Some("static")),
            ("broken", &[("composer.json", "{ nope"), ("index.php", "<?php")], Some("php")),
            ("empty", &[], None),
        ];
        for (name, files, want) in cases {
            let dir = project(name, files);
            assert_eq!(detect(&dir), *want, "{name}");
            let _ = fs::remove_dir_all(dir);
        }
    }
}
