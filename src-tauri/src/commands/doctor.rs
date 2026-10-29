//! The diagnostics page (what most often stops a local PHP setup on Windows,
//! each with what to do about it) and moving projects and databases over
//! from XAMPP or Laragon.

use super::{blocking, sites};
use crate::engine::import::{self, FoundProject};
use crate::engine::{dbio, dns, mailpit, mariadb, nginx, php, postgres, redis, supervisor, tools};
use crate::error::{AppError, AppResult};
use crate::model::Site;
use crate::state::AppState;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use tauri::State;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    /// "ok", "info", "warn" or "error".
    pub level: &'static str,
    pub title: String,
    pub detail: String,
    /// What the check's button does: "services", "nginx", "php", "sites",
    /// "import", or "url:<address>" to open in the browser.
    pub action: Option<String>,
}

fn check(id: &str, level: &'static str, title: String, detail: String, action: Option<&str>) -> Check {
    Check { id: id.to_owned(), level, title, detail, action: action.map(str::to_owned) }
}

const VC_REDIST_URL: &str = "https://aka.ms/vs/17/release/vc_redist.x64.exe";

/// Run every check. Takes a few seconds at most: the slow parts (asking which
/// program holds a port, resolving a `.test` name) only run when needed.
#[tauri::command]
pub async fn doctor_run(state: State<'_, AppState>) -> AppResult<Vec<Check>> {
    let cfg = state.config.lock().unwrap().clone();
    let sup = state.supervisor.clone();
    let dns_rule = *state.dns_rule.lock().unwrap();
    blocking(move || Ok(run_checks(&cfg, &sup, dns_rule))).await
}

fn run_checks(cfg: &crate::config::ZefaroConfig, sup: &supervisor::Supervisor, dns_rule: Option<bool>) -> Vec<Check> {
    let mut out = Vec::new();

    // PHP
    let installed = php::installed();
    if installed.is_empty() {
        out.push(check(
            "php",
            "error",
            crate::tr!("No PHP version is installed", "Belum ada versi PHP terpasang").into(),
            crate::tr!("Sites need PHP. Install a version on the Services page.", "Situs butuh PHP. Pasang satu versi di halaman Layanan.").into(),
            Some("services"),
        ));
    } else if !php::is_installed(&cfg.default_php) {
        out.push(check(
            "php",
            "warn",
            crate::tr!("The active PHP version isn't installed", "Versi PHP aktif belum terpasang").into(),
            crate::tr!(
                format!("PHP {} is chosen as active, but only {} are installed. Choose one of those.", cfg.default_php, installed.keys().cloned().collect::<Vec<_>>().join(", ")),
                format!("PHP {} dipilih sebagai versi aktif, tetapi yang terpasang hanya {}. Pilih salah satunya.", cfg.default_php, installed.keys().cloned().collect::<Vec<_>>().join(", "))
            ),
            Some("php"),
        ));
    } else {
        out.push(check(
            "php",
            "ok",
            crate::tr!(format!("PHP {} is active", cfg.default_php), format!("PHP {} aktif", cfg.default_php)),
            crate::tr!(
                format!("Installed: {}.", installed.keys().cloned().collect::<Vec<_>>().join(", ")),
                format!("Terpasang: {}.", installed.keys().cloned().collect::<Vec<_>>().join(", "))
            ),
            None,
        ));
    }

    // Visual C++ runtime
    let missing = import::missing_vc_runtime();
    if missing.is_empty() {
        out.push(check(
            "vcruntime",
            "ok",
            crate::tr!("The Visual C++ runtime is installed", "Runtime Visual C++ terpasang").into(),
            crate::tr!("PHP, nginx and MariaDB have the Microsoft libraries they load.", "PHP, nginx, dan MariaDB punya pustaka Microsoft yang dibutuhkannya.").into(),
            None,
        ));
    } else {
        out.push(check(
            "vcruntime",
            "error",
            crate::tr!("The Visual C++ runtime is missing", "Runtime Visual C++ tidak ada").into(),
            crate::tr!(
                format!("{} not found. PHP and MariaDB won't start without it. Install Microsoft's Visual C++ Redistributable (x64), then restart Zefaro.", missing.join(", ")),
                format!("{} tidak ditemukan. PHP dan MariaDB tidak bisa berjalan tanpanya. Pasang Visual C++ Redistributable (x64) dari Microsoft, lalu buka ulang Zefaro.", missing.join(", "))
            ),
            Some(&format!("url:{VC_REDIST_URL}")),
        ));
    }

    // Ports: a port Zefaro needs, held by another program while Zefaro's own
    // service is stopped.
    let ports: [(&str, &str, u16, bool, &str); 8] = [
        (nginx::SERVICE_ID, "nginx (HTTP)", cfg.nginx.http_port, false, "nginx"),
        (nginx::SERVICE_ID, "nginx (HTTPS)", cfg.nginx.https_port, false, "nginx"),
        (mariadb::SERVICE_ID, "MariaDB", mariadb::PORT, false, "services"),
        (postgres::SERVICE_ID, "PostgreSQL", postgres::PORT, false, "services"),
        (redis::SERVICE_ID, "Redis", redis::PORT, false, "services"),
        (mailpit::SERVICE_ID, "Mailpit (SMTP)", cfg.mailpit.smtp_port, false, "services"),
        (mailpit::SERVICE_ID, "Mailpit", cfg.mailpit.ui_port, false, "services"),
        (dns::SERVICE_ID, "DNS", dns::PORT, true, "services"),
    ];
    let mut conflicts = 0;
    for (id, label, port, udp, action) in ports {
        if sup.is_running(id) {
            continue;
        }
        let held = if udp { supervisor::port_owner(port, true).is_some() } else { supervisor::port_open(port) };
        if !held {
            continue;
        }
        conflicts += 1;
        let owner = supervisor::port_owner(port, udp);
        let name = owner.as_ref().map(|(_, n)| n.to_ascii_lowercase()).unwrap_or_default();
        let hint = if name.contains("httpd") || name.contains("mysqld") {
            crate::tr!(
                " It looks like XAMPP or Laragon: stop it in their control panel, or change the port in Zefaro.",
                " Sepertinya XAMPP atau Laragon: hentikan lewat panel kontrolnya, atau ganti port di Zefaro."
            )
        } else {
            ""
        };
        out.push(check(
            &format!("port-{port}"),
            "error",
            crate::tr!(format!("{label} can't use port {port}"), format!("{label} tidak bisa memakai port {port}")),
            format!("{}{hint}", supervisor::port_conflict(port, udp)),
            Some(action),
        ));
    }
    if conflicts == 0 {
        out.push(check(
            "ports",
            "ok",
            crate::tr!("No other program holds Zefaro's ports", "Tidak ada program lain yang memakai port Zefaro").into(),
            crate::tr!(
                format!("Checked {}, {}, 3306, 5432, 6379, {}, {} and 53.", cfg.nginx.http_port, cfg.nginx.https_port, cfg.mailpit.smtp_port, cfg.mailpit.ui_port),
                format!("Diperiksa: {}, {}, 3306, 5432, 6379, {}, {}, dan 53.", cfg.nginx.http_port, cfg.nginx.https_port, cfg.mailpit.smtp_port, cfg.mailpit.ui_port)
            ),
            None,
        ));
    }

    // .test names
    match dns_rule {
        Some(false) => out.push(check(
            "dns",
            "warn",
            crate::tr!(format!("Windows doesn't send .{} to Zefaro", cfg.tld), format!("Windows belum mengarahkan .{} ke Zefaro", cfg.tld)),
            crate::tr!("Set up the DNS rule on the Services page; Windows asks for administrator rights once.", "Siapkan aturan DNS di halaman Layanan; Windows meminta hak administrator sekali.").into(),
            Some("services"),
        )),
        Some(true) if !sup.is_running(dns::SERVICE_ID) => out.push(check(
            "dns",
            "warn",
            crate::tr!("Zefaro's DNS isn't running", "DNS Zefaro belum berjalan").into(),
            crate::tr!(format!("Site addresses under .{} won't open until it runs. Start it on the Services page.", cfg.tld), format!("Alamat situs .{} tidak bisa dibuka sebelum DNS berjalan. Mulai di halaman Layanan.", cfg.tld)),
            Some("services"),
        )),
        Some(true) => {
            if dns::os_resolves(&cfg.tld) {
                out.push(check(
                    "dns",
                    "ok",
                    crate::tr!(format!(".{} names resolve to this computer", cfg.tld), format!("Nama .{} mengarah ke komputer ini", cfg.tld)),
                    crate::tr!("Windows asked Zefaro's DNS and got 127.0.0.1.", "Windows bertanya ke DNS Zefaro dan mendapat 127.0.0.1.").into(),
                    None,
                ));
            } else {
                out.push(check(
                    "dns",
                    "error",
                    crate::tr!(format!(".{} names don't resolve", cfg.tld), format!("Nama .{} tidak bisa di-resolve", cfg.tld)),
                    crate::tr!(
                        "The DNS rule is set and Zefaro's DNS runs, but Windows didn't get an answer. A VPN or a security program that handles DNS can cause this; try with it off.",
                        "Aturan DNS sudah ada dan DNS Zefaro berjalan, tetapi Windows tidak mendapat jawaban. VPN atau program keamanan yang menangani DNS bisa menjadi penyebabnya; coba dengan program itu dimatikan."
                    )
                    .into(),
                    Some("services"),
                ));
            }
        }
        None => {}
    }

    // The hosts file can send a .test name elsewhere.
    let hosts = fs::read_to_string(import::hosts_path()).unwrap_or_default();
    let overrides = import::hosts_overrides(&hosts, &cfg.tld);
    if !overrides.is_empty() {
        let list = overrides.iter().map(|(n, ip)| format!("{n} → {ip}")).collect::<Vec<_>>().join(", ");
        out.push(check(
            "hosts",
            "warn",
            crate::tr!("The hosts file overrides some site names", "File hosts menimpa beberapa nama situs").into(),
            crate::tr!(
                format!("{list}. Windows uses these before asking Zefaro. Remove the lines from {} (as administrator).", import::hosts_path().display()),
                format!("{list}. Windows memakai ini sebelum bertanya ke Zefaro. Hapus barisnya dari {} (sebagai administrator).", import::hosts_path().display())
            ),
            None,
        ));
    }

    // HTTPS
    if cfg.sites.iter().any(|s| s.secured) {
        let ca = super::certs::status(cfg.tld.clone());
        if ca.created && !ca.trusted {
            out.push(check(
                "https",
                "warn",
                crate::tr!("Browsers don't trust Zefaro's certificates yet", "Browser belum memercayai sertifikat Zefaro").into(),
                crate::tr!("Secured sites show a warning until you trust Zefaro's certificate authority (Sites page).", "Situs yang diamankan menampilkan peringatan sampai Anda memercayai otoritas sertifikat Zefaro (halaman Situs).").into(),
                Some("sites"),
            ));
        }
    }

    // PATH
    if !installed.is_empty() && !tools::bin_on_path() {
        out.push(check(
            "path",
            "warn",
            crate::tr!("Zefaro's folder isn't on PATH", "Folder Zefaro belum ada di PATH").into(),
            crate::tr!("php and composer don't work in a terminal until it is. Add it from the PHP page.", "php dan composer belum bisa dipakai di terminal sebelum itu. Tambahkan dari halaman PHP.").into(),
            Some("php"),
        ));
    }

    // Site folders
    for site in &cfg.sites {
        if !Path::new(&site.path).is_dir() {
            out.push(check(
                &format!("site-{}", site.name),
                "error",
                crate::tr!(format!("{}'s folder is gone", site.name), format!("Folder {} sudah tidak ada", site.name)),
                crate::tr!(
                    format!("{} doesn't exist anymore. Unlink the site, or put the folder back.", site.path),
                    format!("{} sudah tidak ada. Lepas tautan situsnya, atau kembalikan foldernya.", site.path)
                ),
                Some("sites"),
            ));
        }
    }

    // Other tools whose projects can move over.
    for (kind, tool, projects) in import::detect() {
        let name = if kind == "xampp" { "XAMPP" } else { "Laragon" };
        out.push(check(
            &format!("found-{kind}"),
            "info",
            crate::tr!(format!("{name} found at {}", tool.display()), format!("{name} ditemukan di {}", tool.display())),
            crate::tr!(
                format!("Zefaro can link the projects in {} where they are, and copy their databases over.", projects.display()),
                format!("Zefaro bisa menautkan proyek di {} di tempatnya, dan menyalin database-nya.", projects.display())
            ),
            Some("import"),
        ));
    }
    out
}

// --------------------------------------------------------------- import --

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    /// "xampp", "laragon" or "folder".
    pub kind: String,
    pub root: String,
    pub projects: Vec<ImportProject>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportProject {
    #[serde(flatten)]
    pub found: FoundProject,
    /// The site name it would get.
    pub site: String,
    /// A site with that name, or for that folder, already exists.
    pub linked: bool,
}

/// XAMPP's and Laragon's project folders, plus `extra` when the user picked
/// another folder of projects.
#[tauri::command]
pub fn import_scan(extra: Option<String>, state: State<AppState>) -> Vec<ImportSource> {
    let mut sources: Vec<(String, PathBuf)> = import::detect().into_iter().map(|(k, _, p)| (k.to_owned(), p)).collect();
    if let Some(dir) = extra.filter(|d| !d.trim().is_empty()) {
        sources.push(("folder".into(), PathBuf::from(dir)));
    }
    let cfg = state.config.lock().unwrap();
    sources
        .into_iter()
        .map(|(kind, dir)| ImportSource {
            projects: import::scan(&dir)
                .into_iter()
                .map(|found| {
                    let site = sites::slug(&found.folder);
                    let linked = cfg.sites.iter().any(|s| s.name == site || Path::new(&s.path) == Path::new(&found.path));
                    ImportProject { found, site, linked }
                })
                .collect(),
            root: dir.display().to_string(),
            kind,
        })
        .collect()
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkResult {
    pub path: String,
    pub site: Option<Site>,
    pub error: Option<String>,
}

/// Link each folder where it is. One that fails doesn't stop the others.
#[tauri::command]
pub fn import_link(paths: Vec<String>, state: State<AppState>) -> Vec<LinkResult> {
    paths
        .into_iter()
        .map(|path| match sites::link(&state, path.clone(), sites::Link::default()) {
            Ok(site) => LinkResult { path, site: Some(site), error: None },
            Err(e) => LinkResult { path, site: None, error: Some(e.to_string()) },
        })
        .collect()
}

/// Dumps waiting to be loaded into Zefaro's MariaDB.
fn import_dir() -> PathBuf {
    crate::config::config_dir().join("downloads").join("import")
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OldServer {
    /// Something answers on MariaDB's port while Zefaro's own MariaDB is stopped.
    pub running: bool,
    /// Zefaro's MariaDB is the one running.
    pub zefaro_running: bool,
    pub databases: Vec<dbio::DbInfo>,
    /// Dumps already made and not yet loaded, by database name.
    pub waiting: Vec<String>,
    pub error: Option<String>,
}

fn waiting_dumps() -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = fs::read_dir(import_dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let db = name.strip_suffix(".sql.gz")?.to_owned();
            Some((db, e.path()))
        })
        .collect();
    out.sort();
    out
}

/// The MySQL or MariaDB of XAMPP or Laragon, reached on port 3306 as root
/// without a password (both tools' default).
#[tauri::command]
pub async fn import_db_status(state: State<'_, AppState>) -> AppResult<OldServer> {
    let zefaro_running = state.supervisor.is_running(mariadb::SERVICE_ID);
    blocking(move || {
        let waiting = waiting_dumps().into_iter().map(|(n, _)| n).collect();
        let running = !zefaro_running && supervisor::port_open(mariadb::PORT);
        if !running {
            return Ok(OldServer { running, zefaro_running, databases: Vec::new(), waiting, error: None });
        }
        match dbio::list(&dbio::Client::standard()) {
            Ok(databases) => Ok(OldServer { running, zefaro_running, databases, waiting, error: None }),
            Err(e) => Ok(OldServer { running, zefaro_running, databases: Vec::new(), waiting, error: Some(e.to_string()) }),
        }
    })
    .await
}

/// Dump each database from the old server into Zefaro's import folder.
#[tauri::command]
pub async fn import_db_dump(names: Vec<String>, state: State<'_, AppState>) -> AppResult<Vec<String>> {
    if state.supervisor.is_running(mariadb::SERVICE_ID) {
        return Err(AppError::msg(crate::tr!(
            "Stop Zefaro's MariaDB first, then start the old MySQL from XAMPP or Laragon.",
            "Hentikan MariaDB milik Zefaro dulu, lalu jalankan MySQL lama dari XAMPP atau Laragon."
        )));
    }
    blocking(move || {
        let client = dbio::Client::standard();
        fs::create_dir_all(import_dir())?;
        let cancel = AtomicBool::new(false);
        let mut done = Vec::new();
        for name in names {
            if dbio::is_system(&name) {
                continue;
            }
            dbio::export(&client, &name, &import_dir().join(format!("{name}.sql.gz")), true, &cancel, |_| {})?;
            done.push(name);
        }
        Ok(done)
    })
    .await
}

/// Load the waiting dumps into Zefaro's MariaDB, each into a database of the
/// same name (created when missing). A loaded dump is deleted.
#[tauri::command]
pub async fn import_db_load(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    if !state.supervisor.is_running(mariadb::SERVICE_ID) {
        return Err(AppError::msg(crate::tr!(
            "Stop the old MySQL, then start Zefaro's MariaDB (Services) to load the databases.",
            "Hentikan MySQL lama, lalu mulai MariaDB milik Zefaro (Layanan) untuk memuat database-nya."
        )));
    }
    blocking(move || {
        let client = dbio::Client::standard();
        let cancel = AtomicBool::new(false);
        let mut done = Vec::new();
        for (name, file) in waiting_dumps() {
            if !dbio::exists(&client, &name)? {
                dbio::create_db(&client, &name)?;
            }
            dbio::import(&client, &name, &file, None, &cancel, |_| {})?;
            let _ = fs::remove_file(&file);
            done.push(name);
        }
        Ok(done)
    })
    .await
}
