//! New site wizard: make a Laravel app with the Laravel installer, then link
//! it, point its .env at Zefaro's services and optionally secure it. Runs as
//! one job, so the site page's console shows every step.

use super::blocking;
use crate::engine::laravel::{self, JobHandle, SiteJob};
use crate::engine::{dbio, mariadb, mysql, node, paths, php, postgres, process, supervisor};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewSite {
    /// "laravel" (also when empty), "wordpress", "php" or "proxy".
    #[serde(default)]
    pub kind: String,
    /// Proxy sites: the port the project's dev server listens on.
    #[serde(default)]
    pub proxy_port: u16,
    /// Proxy sites: the project's existing folder.
    #[serde(default)]
    pub folder: String,
    pub name: String,
    /// Folder the project folder is made in.
    pub parent: String,
    pub php: String,
    /// "none" | "react" | "vue" | "livewire" | "svelte" | "community"
    pub kit: String,
    /// Composer package of a community starter kit.
    pub community: String,
    /// Starter kits: Laravel's own login and registration pages.
    pub auth: bool,
    pub teams: bool,
    pub livewire_class: bool,
    /// "sqlite" | "mariadb" | "mysql" | "pgsql"
    pub database: String,
    /// "pest" | "phpunit"
    pub testing: String,
    /// npm install and build with Zefaro's Node.js.
    pub node: bool,
    pub git: bool,
    pub https: bool,
    /// Send the app's mail to Mailpit.
    pub mailpit: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewSiteDefaults {
    pub parent: String,
    /// Installed PHP lines, newest first.
    pub php_versions: Vec<String>,
    pub active_php: Option<String>,
    pub installer: bool,
    pub composer: bool,
    /// Active Node.js line, if one is installed.
    pub node: Option<String>,
    pub git: bool,
    pub mariadb_running: bool,
    pub mysql_running: bool,
    /// MySQL is downloaded; its first start otherwise downloads it.
    pub mysql_installed: bool,
    pub mysql_download_mb: u32,
    pub postgres_running: bool,
    /// PostgreSQL is downloaded; its first start otherwise downloads it.
    pub postgres_installed: bool,
    pub postgres_download_mb: u32,
    pub tld: String,
}

fn default_parent() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\")).join("Sites")
}

#[tauri::command]
pub async fn new_site_defaults(state: State<'_, AppState>) -> AppResult<NewSiteDefaults> {
    let cfg = state.config.lock().unwrap().clone();
    blocking(move || {
        let mut php_versions: Vec<String> = php::installed().into_keys().collect();
        php_versions.sort_by_key(|v| std::cmp::Reverse(php::minor_key(v)));
        let git = process::command("where").arg("git").output().map(|o| o.status.success()).unwrap_or(false);
        Ok(NewSiteDefaults {
            parent: if cfg.new_site_parent.is_empty() {
                default_parent().display().to_string()
            } else {
                cfg.new_site_parent.clone()
            },
            active_php: php::is_installed(&cfg.default_php).then(|| cfg.default_php.clone()),
            php_versions,
            installer: paths::laravel_bin().is_file(),
            composer: paths::composer_phar().is_file(),
            node: node::is_installed(&cfg.node_default).then(|| cfg.node_default.clone()),
            git,
            mariadb_running: supervisor::port_open(mariadb::PORT),
            mysql_running: supervisor::port_open(mysql::PORT),
            mysql_installed: mysql::installed(&mysql::Layout::standard()),
            mysql_download_mb: mysql::DOWNLOAD_MB,
            postgres_running: supervisor::port_open(postgres::PORT),
            postgres_installed: postgres::installed(&postgres::Layout::standard()),
            postgres_download_mb: postgres::DOWNLOAD_MB,
            tld: cfg.tld.clone(),
        })
    })
    .await
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewSiteTarget {
    pub path: String,
    pub url: String,
    /// Database name when a database server is chosen: the name with - turned into _.
    pub database: String,
}

/// A site name that is a valid host label and isn't taken.
fn check_name(state: &AppState, name: &str) -> AppResult<()> {
    let valid = !name.is_empty()
        && name.len() <= 63
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !name.starts_with('-')
        && !name.ends_with('-');
    if !valid {
        return Err(AppError::msg(crate::tr!(
            "Use lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
            "Pakai huruf kecil, angka, dan tanda hubung, diawali dan diakhiri huruf atau angka."
        )));
    }
    if state.config.lock().unwrap().sites.iter().any(|s| s.name == name) {
        return Err(AppError::msg(crate::tr!(
            format!("A site named {name} already exists."),
            format!("Situs bernama {name} sudah ada.")
        )));
    }
    Ok(())
}

/// Check a name and folder before anything is made.
fn target(state: &AppState, name: &str, parent: &str) -> AppResult<NewSiteTarget> {
    check_name(state, name)?;
    let cfg = state.config.lock().unwrap();
    if parent.trim().is_empty() || !Path::new(parent).is_absolute() {
        return Err(AppError::msg(crate::tr!(
            "Choose the folder to make the project in.",
            "Pilih folder tempat proyek dibuat."
        )));
    }
    let path = Path::new(parent).join(name);
    if path.exists() {
        return Err(AppError::msg(crate::tr!(
            format!("{} already exists. Pick another name or folder.", path.display()),
            format!("{} sudah ada. Pilih nama atau folder lain.", path.display())
        )));
    }
    Ok(NewSiteTarget {
        url: cfg.url_for(&format!("{name}.{}", cfg.tld), false),
        path: path.display().to_string(),
        database: name.replace('-', "_"),
    })
}

#[tauri::command]
pub fn new_site_check(name: String, parent: String, state: State<AppState>) -> AppResult<NewSiteTarget> {
    target(&state, &name, &parent)
}

/// `laravel new` arguments for the choices (Laravel installer 5.x).
pub fn installer_args(o: &NewSite) -> Vec<String> {
    let mut args = vec!["new".to_owned(), o.name.clone(), "--no-interaction".into(), "--no-ansi".into()];
    // Boost sets up AI coding tools; Zefaro leaves AI out.
    args.push("--no-boost".into());
    let kit = match o.kit.as_str() {
        "react" | "vue" | "livewire" | "svelte" => {
            args.push(format!("--{}", o.kit));
            true
        }
        "community" => {
            args.push(format!("--using={}", o.community.trim()));
            true
        }
        _ => false,
    };
    if kit && o.kit != "community" {
        if !o.auth {
            args.push("--no-authentication".into());
        } else if o.teams {
            args.push("--teams".into());
        }
        if o.kit == "livewire" && o.livewire_class {
            args.push("--livewire-class-components".into());
        }
    }
    args.push(format!(
        "--database={}",
        match o.database.as_str() {
            "mariadb" => "mariadb",
            "mysql" => "mysql",
            "pgsql" => "pgsql",
            _ => "sqlite",
        }
    ));
    args.push(if o.testing == "phpunit" { "--phpunit" } else { "--pest" }.into());
    args.push(if o.node { "--npm" } else { "--no-node" }.into());
    if o.git {
        args.push("--git".into());
    }
    args
}

/// A composer.bat that uses the chosen PHP line, put first on PATH for the
/// installer (Zefaro's own shim uses the active line).
fn composer_shim(php_line: &str) -> AppResult<PathBuf> {
    let dir = crate::config::config_dir().join("runtime").join("shims").join(php_line);
    fs::create_dir_all(&dir)?;
    let bat = format!(
        "@echo off\r\nsetlocal\r\nset \"COMPOSER_HOME={}\"\r\n\"{}\" \"{}\" %*\r\n",
        paths::composer_home().display(),
        paths::php_dir(php_line).join("php.exe").display(),
        paths::composer_phar().display()
    );
    fs::write(dir.join("composer.bat"), bat)?;
    Ok(dir)
}

#[tauri::command]
pub fn new_site_create(options: NewSite, app: AppHandle, state: State<AppState>) -> AppResult<SiteJob> {
    let o = options;
    match o.kind.as_str() {
        "wordpress" | "php" => return create_files_site(o, app, &state),
        "proxy" => return create_proxy_site(o, app, &state),
        _ => {}
    }
    let target = target(&state, &o.name, &o.parent)?;
    if !php::is_installed(&o.php) {
        return Err(AppError::msg(crate::tr!(
            format!("PHP {} isn't installed.", o.php),
            format!("PHP {} belum terpasang.", o.php)
        )));
    }
    if !paths::laravel_bin().is_file() || !paths::composer_phar().is_file() {
        return Err(AppError::msg(crate::tr!(
            "Install Composer and the Laravel installer on the PHP page first.",
            "Pasang Composer dan installer Laravel di halaman PHP terlebih dahulu."
        )));
    }
    if o.kit == "community" && !o.community.trim().contains('/') {
        return Err(AppError::msg(crate::tr!(
            "Enter the starter kit's Composer package, like vendor/package.",
            "Isi paket Composer starter kit, misalnya vendor/paket."
        )));
    }
    if o.database == "mariadb" && !supervisor::port_open(mariadb::PORT) {
        return Err(AppError::msg(crate::tr!(
            "Start MariaDB first (Services → MariaDB).",
            "Mulai MariaDB terlebih dahulu (Layanan → MariaDB)."
        )));
    }
    if o.database == "mysql" && !supervisor::port_open(mysql::PORT) {
        return Err(AppError::msg(crate::tr!(
            "Start MySQL first (Services → MySQL).",
            "Mulai MySQL terlebih dahulu (Layanan → MySQL)."
        )));
    }
    if o.database == "pgsql" && !supervisor::port_open(postgres::PORT) {
        return Err(AppError::msg(crate::tr!(
            "Start PostgreSQL first (Services → PostgreSQL).",
            "Mulai PostgreSQL terlebih dahulu (Layanan → PostgreSQL)."
        )));
    }
    let node_line = state.config.lock().unwrap().node_default.clone();
    if o.node && !node::is_installed(&node_line) {
        return Err(AppError::msg(crate::tr!(
            "Install Node.js on the Node.js page, or turn off building the front end.",
            "Pasang Node.js di halaman Node.js, atau matikan build front end."
        )));
    }
    fs::create_dir_all(&o.parent)?;
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.new_site_parent = o.parent.clone();
        let _ = crate::config::save(&cfg);
    }

    let job = state.site_jobs.begin(&o.name, format!("laravel new {}", o.name));
    let shown = job.job();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let result = create(&state, &job, &o, &target);
        if result.is_err() && Path::new(&target.path).exists() && state.config.lock().unwrap().sites.iter().all(|s| s.name != o.name) {
            job.line(crate::tr!(
                format!("Zefaro left {} as it is. Delete it before trying the same name again.", target.path),
                format!("Zefaro membiarkan {} apa adanya. Hapus folder itu sebelum mencoba nama yang sama lagi.", target.path)
            ));
        }
        job.finish(result.map(|_| Some(0)));
    });
    Ok(shown)
}

/// Remember the folder the wizard made a project in, for next time.
fn remember_parent(state: &AppState, parent: &str) {
    let mut cfg = state.config.lock().unwrap();
    cfg.new_site_parent = parent.to_owned();
    let _ = crate::config::save(&cfg);
}

/// WordPress or a plain PHP folder: made in `parent/name`, then linked.
fn create_files_site(o: NewSite, app: AppHandle, state: &AppState) -> AppResult<SiteJob> {
    let target = target(state, &o.name, &o.parent)?;
    if !php::is_installed(&o.php) {
        return Err(AppError::msg(crate::tr!(
            format!("PHP {} isn't installed.", o.php),
            format!("PHP {} belum terpasang.", o.php)
        )));
    }
    let wordpress = o.kind == "wordpress";
    if wordpress && !supervisor::port_open(mariadb::PORT) {
        return Err(AppError::msg(crate::tr!(
            "WordPress needs MariaDB. Start it first (Services → MariaDB).",
            "WordPress butuh MariaDB. Mulai terlebih dahulu (Layanan → MariaDB)."
        )));
    }
    fs::create_dir_all(&o.parent)?;
    remember_parent(state, &o.parent);
    let label = if wordpress { "WordPress" } else { "PHP" };
    let job = state.site_jobs.begin(&o.name, format!("{label}: {}", o.name));
    let shown = job.job();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let result = if wordpress {
            create_wordpress(&state, &job, &o, &target)
        } else {
            create_plain(&state, &job, &o, &target)
        };
        job.finish(result.map(|_| Some(0)));
    });
    Ok(shown)
}

/// Link the new folder, secure it when asked, and say so in the console.
fn link_new(state: &AppState, job: &JobHandle, o: &NewSite, path: &str, link: super::sites::Link) -> AppResult<crate::model::Site> {
    let site = super::sites::link(state, path.to_owned(), link)?;
    job.line(crate::tr!(format!("Linked {}.", site.url), format!("{} ditautkan.", site.url)));
    if !o.https {
        return Ok(site);
    }
    let secured = super::sites::toggle_secure(state, &o.name)?;
    job.line(crate::tr!(
        format!("Secured {} with HTTPS.", secured.url),
        format!("{} diamankan dengan HTTPS.", secured.url)
    ));
    Ok(secured)
}

fn create_plain(state: &AppState, job: &JobHandle, o: &NewSite, target: &NewSiteTarget) -> AppResult<()> {
    fs::create_dir_all(&target.path)?;
    fs::write(Path::new(&target.path).join("index.php"), crate::engine::starter::plain_index(&o.name))?;
    job.line(crate::tr!(
        format!("Made {} with index.php.", target.path),
        format!("{} dibuat berisi index.php.", target.path)
    ));
    let site = link_new(state, job, o, &target.path, super::sites::Link { php: Some(o.php.clone()), ..Default::default() })?;
    job.line(crate::tr!(format!("Ready: {}", site.url), format!("Siap: {}", site.url)));
    Ok(())
}

fn create_wordpress(state: &AppState, job: &JobHandle, o: &NewSite, target: &NewSiteTarget) -> AppResult<()> {
    use crate::engine::starter;
    let client = dbio::Client::standard();
    if dbio::exists(&client, &target.database)? {
        job.line(crate::tr!(
            format!("Using the existing MariaDB database {}.", target.database),
            format!("Memakai database MariaDB {} yang sudah ada.", target.database)
        ));
    } else {
        dbio::create_db(&client, &target.database)?;
        job.line(crate::tr!(
            format!("Created the MariaDB database {}.", target.database),
            format!("Database MariaDB {} dibuat.", target.database)
        ));
    }
    let (version, url) = starter::latest_wordpress()?;
    job.line(crate::tr!(
        format!("Downloading WordPress {version} from WordPress.org…"),
        format!("Mengunduh WordPress {version} dari WordPress.org…")
    ));
    let zip = starter::download_wordpress(&version, &url)?;
    job.line(crate::tr!(
        "The download matches WordPress.org's checksum.",
        "Unduhan cocok dengan checksum WordPress.org."
    ));
    let dest = Path::new(&target.path);
    starter::unpack_wordpress(&zip, dest)?;
    let sample = fs::read_to_string(dest.join("wp-config-sample.php"))?;
    fs::write(dest.join("wp-config.php"), starter::wp_config(&sample, &target.database, mariadb::PORT, starter::random_secret))?;
    job.line(crate::tr!(
        format!("Unpacked WordPress into {} and wrote wp-config.php.", target.path),
        format!("WordPress dibongkar ke {} dan wp-config.php ditulis.", target.path)
    ));
    let site = link_new(state, job, o, &target.path, super::sites::Link { php: Some(o.php.clone()), ..Default::default() })?;
    job.line(crate::tr!(
        format!("Ready: open {} to name the site and make its admin account.", site.url),
        format!("Siap: buka {} untuk memberi nama situs dan membuat akun admin.", site.url)
    ));
    Ok(())
}

/// A name for a project that already exists and runs its own dev server
/// (Vite, Next.js): nginx forwards `<name>.test` to that port.
fn create_proxy_site(o: NewSite, app: AppHandle, state: &AppState) -> AppResult<SiteJob> {
    check_name(state, &o.name)?;
    let folder = o.folder.trim().to_owned();
    if folder.is_empty() || !Path::new(&folder).is_dir() {
        return Err(AppError::msg(crate::tr!(
            "Choose the project's folder.",
            "Pilih folder proyeknya."
        )));
    }
    if o.proxy_port == 0 {
        return Err(AppError::msg(crate::tr!(
            "Enter the port your dev server listens on, like 5173.",
            "Isi port tempat dev server Anda mendengarkan, misalnya 5173."
        )));
    }
    let (http, https) = {
        let cfg = state.config.lock().unwrap();
        (cfg.nginx.http_port, cfg.nginx.https_port)
    };
    if o.proxy_port == http || o.proxy_port == https {
        return Err(AppError::msg(crate::tr!(
            format!("Port {} is nginx's own. Use the port your dev server prints when it starts.", o.proxy_port),
            format!("Port {} milik nginx sendiri. Pakai port yang ditampilkan dev server saat dimulai.", o.proxy_port)
        )));
    }
    let job = state.site_jobs.begin(&o.name, format!("proxy: {} → localhost:{}", o.name, o.proxy_port));
    let shown = job.job();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let result = (|| -> AppResult<()> {
            let link = super::sites::Link { name: Some(o.name.clone()), proxy: Some(o.proxy_port), ..Default::default() };
            let site = link_new(&state, &job, &o, &folder, link)?;
            job.line(crate::tr!(
                format!("{} forwards to localhost:{}.", site.url, o.proxy_port),
                format!("{} diteruskan ke localhost:{}.", site.url, o.proxy_port)
            ));
            if !supervisor::port_open(o.proxy_port) {
                job.line(crate::tr!(
                    format!("Nothing listens on port {} yet. Start your dev server (for example npm run dev), then open the site.", o.proxy_port),
                    format!("Belum ada yang mendengarkan di port {}. Jalankan dev server Anda (misalnya npm run dev), lalu buka situsnya.", o.proxy_port)
                ));
            }
            Ok(())
        })();
        job.finish(result.map(|_| Some(0)));
    });
    Ok(shown)
}

/// Fails with a message, so the job ends "failed" with it as the last line.
fn step(code: Option<i32>, what: &str) -> AppResult<()> {
    match code {
        Some(0) => Ok(()),
        None => Err(AppError::msg(crate::tr!("Stopped.", "Dihentikan."))),
        Some(code) => Err(AppError::msg(crate::tr!(
            format!("{what} failed (exit code {code})."),
            format!("{what} gagal (kode keluar {code}).")
        ))),
    }
}

/// Variables laravel/agent-detector reads to decide it runs under an agent.
const AGENT_VARS: &[&str] = &[
    "AI_AGENT", "CURSOR_AGENT", "GROK_PLUGIN_ROOT", "GROK_PLUGIN_DATA", "QWEN_CODE", "GEMINI_CLI",
    "CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID", "CODEX_SANDBOX_NETWORK_DISABLED", "AUGMENT_AGENT",
    "OPENCODE_CLIENT", "OPENCODE", "AMP_CURRENT_THREAD_ID", "CLAUDECODE", "CLAUDE_CODE", "REPL_ID",
    "COPILOT_MODEL", "COPILOT_ALLOW_ALL", "COPILOT_GITHUB_TOKEN", "COPILOT_CLI", "ANTIGRAVITY_AGENT",
    "ANTIGRAVITY_CLI_ALIAS", "PI_CODING_AGENT", "MATTERHORN_SESSION_ID", "JUNIE_DATA", "JUNIE_SHIM_PATH",
    "KIRO_AGENT_PATH", "KIMI_PLUGIN_ROOT", "CLINE_ACTIVE", "GOOSE_TERMINAL", "OPENCLAW_SHELL", "ZCODE_ENV",
    "CRUSH", "WINDSURF_CASCADE_TERMINAL", "TERM_PROGRAM",
];

/// `php laravel new …` in the parent folder, with the chosen PHP first on PATH.
fn installer_command(o: &NewSite) -> AppResult<std::process::Command> {
    // The installer runs composer, php artisan and npm from PATH.
    let rest = laravel::tool_path(&o.php);
    let mut dirs = vec![composer_shim(&o.php)?];
    dirs.extend(std::env::split_paths(&rest));
    let path = std::env::join_paths(dirs).unwrap_or(rest);
    let mut cmd = process::command(paths::php_dir(&o.php).join("php.exe"));
    cmd.arg("-c")
        .arg(paths::php_dir(&o.php).join("php.ini"))
        .arg(paths::laravel_bin())
        .args(installer_args(o))
        .current_dir(&o.parent)
        .env("PATH", path)
        .env("COMPOSER_HOME", paths::composer_home())
        .env("COMPOSER_NO_INTERACTION", "1");
    // Under a coding agent the installer prints one line of JSON instead of
    // its progress. Zefaro may be started from such a terminal; show the progress.
    for var in AGENT_VARS {
        cmd.env_remove(var);
    }
    Ok(cmd)
}

fn create(state: &AppState, job: &JobHandle, o: &NewSite, target: &NewSiteTarget) -> AppResult<()> {
    if o.database == "pgsql" {
        let pg = postgres::Layout::standard();
        if postgres::database_exists(&pg, &target.database)? {
            job.line(crate::tr!(
                format!("Using the existing PostgreSQL database {}.", target.database),
                format!("Memakai database PostgreSQL {} yang sudah ada.", target.database)
            ));
        } else {
            postgres::create_database(&pg, &target.database)?;
            job.line(crate::tr!(
                format!("Created the PostgreSQL database {}.", target.database),
                format!("Database PostgreSQL {} dibuat.", target.database)
            ));
        }
    }
    if o.database == "mysql" {
        let my = mysql::Layout::standard();
        if mysql::database_exists(&my, &target.database)? {
            job.line(crate::tr!(
                format!("Using the existing MySQL database {}.", target.database),
                format!("Memakai database MySQL {} yang sudah ada.", target.database)
            ));
        } else {
            mysql::create_database(&my, &target.database)?;
            job.line(crate::tr!(
                format!("Created the MySQL database {}.", target.database),
                format!("Database MySQL {} dibuat.", target.database)
            ));
        }
    }
    if o.database == "mariadb" {
        let client = dbio::Client::standard();
        if dbio::exists(&client, &target.database)? {
            job.line(crate::tr!(
                format!("Using the existing MariaDB database {}.", target.database),
                format!("Memakai database MariaDB {} yang sudah ada.", target.database)
            ));
        } else {
            dbio::create_db(&client, &target.database)?;
            job.line(crate::tr!(
                format!("Created the MariaDB database {}.", target.database),
                format!("Database MariaDB {} dibuat.", target.database)
            ));
        }
    }

    let args = installer_args(o);
    job.line(format!("> laravel {}", args.join(" ")));
    step(job.run(installer_command(o)?)?, "laravel new")?;
    if !Path::new(&target.path).join("artisan").is_file() {
        return Err(AppError::msg(crate::tr!(
            "The installer finished, but the project folder has no artisan file.",
            "Installer selesai, tetapi folder proyek tidak punya file artisan."
        )));
    }

    let site = super::sites::link(
        state,
        target.path.clone(),
        super::sites::Link { php: Some(o.php.clone()), ..Default::default() },
    )?;
    job.line(crate::tr!(format!("Linked {}.", site.url), format!("{} ditautkan.", site.url)));
    let site = if o.https {
        let secured = super::sites::toggle_secure(state, &o.name)?;
        job.line(crate::tr!(
            format!("Secured {} with HTTPS.", secured.url),
            format!("{} diamankan dengan HTTPS.", secured.url)
        ));
        secured
    } else {
        site
    };

    let env_path = Path::new(&target.path).join(".env");
    let mut text = fs::read_to_string(&env_path)?;
    let mut values: Vec<(&str, String)> = vec![("APP_URL", site.url.clone())];
    if o.mailpit {
        let port = state.config.lock().unwrap().mailpit.smtp_port;
        values.extend([
            ("MAIL_MAILER", "smtp".to_owned()),
            ("MAIL_HOST", "127.0.0.1".to_owned()),
            ("MAIL_PORT", port.to_string()),
            ("MAIL_USERNAME", "null".to_owned()),
            ("MAIL_PASSWORD", "null".to_owned()),
        ]);
    }
    let db_port = match o.database.as_str() {
        "mariadb" => Some(mariadb::PORT),
        "mysql" => Some(mysql::PORT),
        "pgsql" => Some(postgres::PORT),
        _ => None,
    };
    if let Some(port) = db_port {
        values.extend([
            ("DB_HOST", "127.0.0.1".to_owned()),
            ("DB_PORT", port.to_string()),
            ("DB_DATABASE", target.database.clone()),
            ("DB_USERNAME", "root".to_owned()),
            ("DB_PASSWORD", String::new()),
        ]);
    }
    for (key, value) in &values {
        text = laravel::set_env(&text, key, value);
    }
    fs::write(&env_path, text)?;
    job.line(crate::tr!(
        format!("Set {} in .env.", values.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(", ")),
        format!("{} diisi di .env.", values.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(", "))
    ));
    if o.database != "sqlite" {
        // The installer migrates before Zefaro sets the database login; run it
        // again now, which does nothing if every migration already ran.
        job.line("> php artisan migrate --force");
        let app = laravel::App { path: PathBuf::from(&target.path), php: o.php.clone() };
        step(job.run(laravel::artisan_command(&app, &["migrate".into(), "--force".into()])?)?, "php artisan migrate")?;
    }
    job.line(crate::tr!(format!("Ready: {}", site.url), format!("Siap: {}", site.url)));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> NewSite {
        NewSite {
            kind: "laravel".into(),
            proxy_port: 0,
            folder: String::new(),
            name: "shop".into(),
            parent: "C:\\Sites".into(),
            php: "8.4".into(),
            kit: "none".into(),
            community: String::new(),
            auth: true,
            teams: false,
            livewire_class: false,
            database: "sqlite".into(),
            testing: "pest".into(),
            node: false,
            git: false,
            https: false,
            mailpit: true,
        }
    }

    #[test]
    fn plain_laravel_args() {
        assert_eq!(
            installer_args(&options()),
            ["new", "shop", "--no-interaction", "--no-ansi", "--no-boost", "--database=sqlite", "--pest", "--no-node"]
        );
    }

    #[test]
    fn starter_kit_args() {
        let o = NewSite { kit: "livewire".into(), teams: true, livewire_class: true, database: "mariadb".into(), testing: "phpunit".into(), node: true, git: true, ..options() };
        let args = installer_args(&o);
        for flag in ["--livewire", "--teams", "--livewire-class-components", "--database=mariadb", "--phpunit", "--npm", "--git"] {
            assert!(args.contains(&flag.to_owned()), "{flag} in {args:?}");
        }
        let o = NewSite { database: "pgsql".into(), ..options() };
        assert!(installer_args(&o).contains(&"--database=pgsql".to_owned()));
        let o = NewSite { database: "mysql".into(), ..options() };
        assert!(installer_args(&o).contains(&"--database=mysql".to_owned()));
        let o = NewSite { kit: "react".into(), auth: false, teams: true, ..options() };
        let args = installer_args(&o);
        assert!(args.contains(&"--no-authentication".to_owned()));
        assert!(!args.contains(&"--teams".to_owned()));
        let o = NewSite { kit: "community".into(), community: " acme/kit ".into(), auth: false, ..options() };
        let args = installer_args(&o);
        assert!(args.contains(&"--using=acme/kit".to_owned()));
        assert!(!args.contains(&"--no-authentication".to_owned()));
    }

    /// Runs the real Laravel installer (needs PHP 8.3, Composer and the
    /// installer from Zefaro, and network or Composer's cache). Makes a project
    /// in the temp folder and deletes it.
    #[test]
    #[ignore]
    fn live_installer_makes_a_laravel_app() {
        let parent = std::env::temp_dir().join("zefaro-new-site-test");
        let _ = fs::remove_dir_all(&parent);
        fs::create_dir_all(&parent).unwrap();
        let o = NewSite { name: "wizard-app".into(), parent: parent.display().to_string(), php: "8.3".into(), mailpit: false, ..options() };
        let out = installer_command(&o).unwrap().output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout).into_owned() + &String::from_utf8_lossy(&out.stderr);
        let app = parent.join("wizard-app");
        assert!(out.status.success(), "{text}");
        assert!(app.join("artisan").is_file(), "{text}");
        assert!(app.join("database").join("database.sqlite").is_file(), "{text}");
        let composer = fs::read_to_string(app.join("composer.json")).unwrap();
        assert!(composer.contains("pestphp/pest"), "Pest wasn't installed");
        assert!(!composer.contains("laravel/boost"), "Boost was installed");
        // Progress, not the one-line JSON the installer prints for agents.
        assert!(!text.trim_start().starts_with("{\"success\""), "{text}");
        let _ = fs::remove_dir_all(&parent);
    }

    /// A Laravel app on PostgreSQL: Zefaro's PostgreSQL from the pinned zip in
    /// a temp folder on port 5432 (skipped if something else holds it), a
    /// database for the app, the installer with --database=pgsql (which
    /// migrates), then Zefaro's runner reads the app's tables. Set
    /// ZEFARO_PG_ZIP_DIR to a folder holding the zip to skip downloading it.
    #[test]
    #[ignore]
    fn live_laravel_app_on_postgresql() {
        use crate::engine::supervisor::{port_open, Supervisor};
        if port_open(postgres::PORT) {
            eprintln!("port 5432 is taken; skipped");
            return;
        }
        let root = std::env::temp_dir().join("zefaro-pg-app-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let scratch = std::env::var_os("ZEFARO_PG_ZIP_DIR").map(PathBuf::from).unwrap_or_else(|| root.join("dl"));
        let pg = postgres::Layout {
            base: root.join("pg"),
            data: root.join("data"),
            log: root.join("postgresql.log"),
            port: postgres::PORT,
        };
        postgres::prepare(&pg, &scratch, true).unwrap();
        let sup = Supervisor::default();
        sup.start(postgres::spec(&pg)).unwrap();
        postgres::create_database(&pg, "pg_app").unwrap();

        let o = NewSite {
            name: "pg-app".into(),
            parent: root.display().to_string(),
            php: "8.3".into(),
            database: "pgsql".into(),
            mailpit: false,
            ..options()
        };
        let out = installer_command(&o).unwrap().output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout).into_owned() + &String::from_utf8_lossy(&out.stderr);
        let app_dir = root.join("pg-app");
        // The installer names the database after the app; point .env at Zefaro's server.
        let env = fs::read_to_string(app_dir.join(".env")).unwrap();
        let mut env = env;
        for (k, v) in [("DB_HOST", "127.0.0.1"), ("DB_PORT", "5432"), ("DB_DATABASE", "pg_app"), ("DB_USERNAME", "root"), ("DB_PASSWORD", "")] {
            env = laravel::set_env(&env, k, v);
        }
        fs::write(app_dir.join(".env"), env).unwrap();

        let app = laravel::App { path: app_dir.clone(), php: "8.3".into() };
        let result = (|| {
            assert!(out.status.success(), "{text}");
            let mut migrate = laravel::artisan_command(&app, &["migrate".into(), "--force".into()]).unwrap();
            let m = migrate.output().unwrap();
            assert!(m.status.success(), "{}", String::from_utf8_lossy(&m.stdout));
            let overview = laravel::query(&app, &serde_json::json!({ "op": "overview" })).unwrap();
            assert_eq!(overview["drivers"]["databaseDriver"], "pgsql");
            assert_eq!(overview["database"]["connected"], true, "{overview}");
            let tables = laravel::query(&app, &serde_json::json!({ "op": "tables" })).unwrap();
            assert!(tables["tables"].as_array().unwrap().iter().any(|t| t["name"] == "users"), "{tables}");
            let rows = laravel::query(&app, &serde_json::json!({ "op": "rows", "table": "users" })).unwrap();
            assert_eq!(rows["primaryKey"], serde_json::json!(["id"]));
        })();
        sup.stop(postgres::SERVICE_ID).unwrap();
        let _ = fs::remove_dir_all(&root);
        result
    }
}
