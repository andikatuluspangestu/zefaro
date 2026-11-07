//! A site's own php.ini limits. php-cgi reads a `.user.ini` in the site's
//! document root for every request (FastCGI's PHP_VALUE is PHP-FPM only), so
//! that's where they go: a file marked as Zefaro's, never one the project has
//! of its own. In a Git repository it's listed in `.git/info/exclude`, which
//! stays on this computer, so it isn't committed.

use crate::error::{AppError, AppResult};
use crate::model::PhpLimits;
use std::fs;
use std::path::{Path, PathBuf};

const MARK: &str = "; Written by Zefaro: this site's own PHP limits.";
const EXCLUDE_NOTE: &str = "# Zefaro: a site's own PHP limits, kept out of commits.";

pub fn file(root: &Path) -> PathBuf {
    root.join(".user.ini")
}

pub fn render(s: &PhpLimits) -> String {
    let mb = |v: i64| if v < 0 { "-1".to_owned() } else { format!("{v}M") };
    format!(
        "{MARK}\n; Change them on the site's page in Zefaro, not here.\n\
         upload_max_filesize = {}\npost_max_size = {}\nmemory_limit = {}\nmax_input_vars = {}\n",
        mb(s.max_upload_mb),
        mb(s.max_upload_mb.max(8)),
        mb(s.memory_limit_mb),
        s.max_input_vars
    )
}

/// The project's own `.user.ini`, which Zefaro leaves alone.
fn foreign(path: &Path) -> bool {
    fs::read_to_string(path).is_ok_and(|t| !t.starts_with(MARK))
}

/// Write the site's limits (`Some`) or take them away (`None`). `project` is
/// the site's folder, `root` its document root.
pub fn apply(project: &Path, root: &Path, limits: Option<&PhpLimits>) -> AppResult<()> {
    let path = file(root);
    if foreign(&path) {
        return Err(AppError::msg(crate::tr!(
            format!("{} is the project's own file, so Zefaro won't change it. Put the limits in it yourself, or remove it.", path.display()),
            format!("{} adalah file milik proyek, jadi Zefaro tidak mengubahnya. Tulis batasnya sendiri di sana, atau hapus file itu.", path.display())
        )));
    }
    match limits {
        Some(s) => {
            crate::engine::php::validate_limits(s)?;
            fs::write(&path, render(s))?;
            exclude(project, root);
        }
        None => {
            if path.is_file() {
                fs::remove_file(&path)?;
            }
        }
    }
    Ok(())
}

/// List the file in `.git/info/exclude` once (a Git repository only).
fn exclude(project: &Path, root: &Path) {
    let git = project.join(".git");
    if !git.is_dir() {
        return;
    }
    let rel = file(root)
        .strip_prefix(project)
        .map(|p| format!("/{}", p.display().to_string().replace('\\', "/")))
        .unwrap_or_else(|_| "/.user.ini".into());
    let path = git.join("info").join("exclude");
    let text = fs::read_to_string(&path).unwrap_or_default();
    if text.lines().any(|l| l.trim() == rel) {
        return;
    }
    let _ = fs::create_dir_all(git.join("info"));
    let sep = if text.is_empty() || text.ends_with('\n') { "" } else { "\n" };
    let _ = fs::write(&path, format!("{text}{sep}{EXCLUDE_NOTE}\n{rel}\n"));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("zefaro-siteini-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(p.join("public")).unwrap();
        fs::create_dir_all(p.join(".git").join("info")).unwrap();
        fs::write(p.join(".git").join("info").join("exclude"), "# git ls-files --others --exclude-from=.git/info/exclude").unwrap();
        p
    }

    #[test]
    fn writes_the_limits_and_keeps_them_out_of_commits() {
        let p = project("write");
        let root = p.join("public");
        let limits = PhpLimits { max_upload_mb: 64, memory_limit_mb: 512, max_input_vars: 5000 };
        apply(&p, &root, Some(&limits)).unwrap();
        let ini = fs::read_to_string(file(&root)).unwrap();
        for line in ["upload_max_filesize = 64M", "post_max_size = 64M", "memory_limit = 512M", "max_input_vars = 5000"] {
            assert!(ini.contains(line), "{line}\n{ini}");
        }
        apply(&p, &root, Some(&limits)).unwrap();
        let exclude = fs::read_to_string(p.join(".git/info/exclude")).unwrap();
        assert_eq!(exclude.matches("/public/.user.ini").count(), 1, "listed once:\n{exclude}");
        assert!(exclude.starts_with("# git ls-files"), "the file's own lines stay");
        apply(&p, &root, None).unwrap();
        assert!(!file(&root).exists());
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn a_projects_own_user_ini_is_left_alone() {
        let p = project("foreign");
        let root = p.join("public");
        fs::write(file(&root), "memory_limit = 1G\n").unwrap();
        assert!(apply(&p, &root, Some(&PhpLimits::default())).is_err());
        assert!(apply(&p, &root, None).is_err());
        assert_eq!(fs::read_to_string(file(&root)).unwrap(), "memory_limit = 1G\n");
        let _ = fs::remove_dir_all(&p);
    }
}
