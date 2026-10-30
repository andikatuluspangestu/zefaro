//! zefaro.json: read it before linking a folder, link the folder and apply it,
//! and write one from a site's current settings.

use super::{blocking, services, sites};
use crate::engine::laravel::{self, Worker};
use crate::engine::project::{self, ProjectFile, ProjectWorker};
use crate::engine::{dbio, mariadb, mysql, php, postgres, supervisor};
use crate::error::{AppError, AppResult};
use crate::model::Site;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

/// What linking a folder with a zefaro.json would do, for the confirmation.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPreview {
    pub file: ProjectFile,
    /// The site name it would get.
    pub name: String,
    pub name_taken: bool,
    /// The PHP line it asks for is installed (true when it asks for none).
    pub php_installed: bool,
}

#[tauri::command]
pub fn project_read(path: String, state: State<AppState>) -> AppResult<Option<ProjectPreview>> {
    let Some(file) = project::read(Path::new(&path))? else {
        return Ok(None);
    };
    let folder = Path::new(&path).file_name().and_then(|s| s.to_str()).unwrap_or_default();
    let name = sites::slug(file.name.as_deref().unwrap_or(folder));
    let name_taken = state.config.lock().unwrap().sites.iter().any(|s| s.name == name);
    Ok(Some(ProjectPreview {
        php_installed: file.php.as_deref().is_none_or(php::is_installed),
        name_taken,
        name,
        file,
    }))
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectReport {
    pub site: Site,
    pub done: Vec<String>,
    pub warnings: Vec<String>,
}

/// Link a folder and apply its zefaro.json. What can't be done (a PHP line
/// that isn't installed, a service that won't start) becomes a warning, and
/// the rest still happens.
#[tauri::command]
pub async fn project_link(path: String, state: State<'_, AppState>) -> AppResult<ProjectReport> {
    let file = project::read(Path::new(&path))?.ok_or_else(|| {
        AppError::msg(crate::tr!(
            format!("This folder has no {}.", project::FILE_NAME),
            format!("Folder ini tidak punya {}.", project::FILE_NAME)
        ))
    })?;
    let mut done = Vec::new();
    let mut warnings = Vec::new();

    let php_line = match file.php.clone() {
        Some(line) if php::is_installed(&line) => Some(line),
        Some(line) => {
            warnings.push(crate::tr!(
                format!("PHP {line} isn't installed, so the site uses the active version. Install it on the PHP page, then choose it for the site."),
                format!("PHP {line} belum terpasang, jadi situs memakai versi aktif. Pasang di halaman PHP, lalu pilih untuk situs ini.")
            ));
            None
        }
        None => None,
    };
    let site = sites::link(&state, path, sites::Link { php: php_line, name: file.name.clone(), proxy: file.proxy })?;
    done.push(crate::tr!(format!("Linked {}.", site.url), format!("{} ditautkan.", site.url)));
    let site = if file.https == Some(true) {
        let secured = sites::toggle_secure(&state, &site.name)?;
        done.push(crate::tr!(format!("Turned on HTTPS: {}.", secured.url), format!("HTTPS dinyalakan: {}.", secured.url)));
        secured
    } else {
        site
    };

    // Services, one after another (MariaDB before the database below).
    let cfg = state.config.lock().unwrap().clone();
    let sup = state.supervisor.clone();
    let wanted = file.services.clone();
    let (started, failed) = blocking(move || {
        let mut started = Vec::new();
        let mut failed = Vec::new();
        for id in wanted {
            if !project::SERVICES.contains(&id.as_str()) {
                failed.push((id, None));
                continue;
            }
            match services::start(&cfg, &sup, &id) {
                Ok(()) => started.push(id),
                Err(e) => failed.push((id, Some(e.to_string()))),
            }
        }
        Ok((started, failed))
    })
    .await?;
    if !started.is_empty() {
        let list = started.join(", ");
        done.push(crate::tr!(format!("Started {list}."), format!("{list} dimulai.")));
    }
    for (id, error) in failed {
        warnings.push(match error {
            None => crate::tr!(
                format!("{} asks for a service called {id}, which Zefaro doesn't have.", project::FILE_NAME),
                format!("{} meminta layanan bernama {id}, yang tidak ada di Zefaro.", project::FILE_NAME)
            ),
            Some(e) => crate::tr!(format!("{id} didn't start: {e}"), format!("{id} gagal dimulai: {e}")),
        });
    }

    if let Some(db) = file.database.clone() {
        match blocking(move || ensure_database(&db.driver, &db.name)).await {
            Ok(line) => done.push(line),
            Err(e) => warnings.push(e.to_string()),
        }
    }

    if !file.workers.is_empty() {
        let added = add_workers(&state, &site.name, &file.workers)?;
        if added > 0 {
            done.push(crate::tr!(format!("Added {added} worker(s)."), format!("{added} worker ditambahkan.")));
        }
    }
    Ok(ProjectReport { site, done, warnings })
}

/// Create the database when it doesn't exist; says which happened.
fn ensure_database(driver: &str, name: &str) -> AppResult<String> {
    dbio::validate_name(name)?;
    match driver {
        "mariadb" => {
            if !supervisor::port_open(mariadb::PORT) {
                return Err(AppError::msg(crate::tr!(
                    format!("MariaDB isn't running, so the database {name} wasn't created. Start MariaDB, then create it on the Databases page."),
                    format!("MariaDB belum berjalan, jadi database {name} tidak dibuat. Mulai MariaDB, lalu buat di halaman Database.")
                )));
            }
            let client = dbio::Client::standard();
            if dbio::exists(&client, name)? {
                return Ok(crate::tr!(format!("The database {name} already exists."), format!("Database {name} sudah ada.")));
            }
            dbio::create_db(&client, name)?;
        }
        "mysql" => {
            if !supervisor::port_open(mysql::PORT) {
                return Err(AppError::msg(crate::tr!(
                    format!("MySQL isn't running, so the database {name} wasn't created."),
                    format!("MySQL belum berjalan, jadi database {name} tidak dibuat.")
                )));
            }
            let my = mysql::Layout::standard();
            if mysql::database_exists(&my, name)? {
                return Ok(crate::tr!(format!("The database {name} already exists."), format!("Database {name} sudah ada.")));
            }
            mysql::create_database(&my, name)?;
        }
        "pgsql" | "postgresql" => {
            if !supervisor::port_open(postgres::PORT) {
                return Err(AppError::msg(crate::tr!(
                    format!("PostgreSQL isn't running, so the database {name} wasn't created."),
                    format!("PostgreSQL belum berjalan, jadi database {name} tidak dibuat.")
                )));
            }
            let pg = postgres::Layout::standard();
            if postgres::database_exists(&pg, name)? {
                return Ok(crate::tr!(format!("The database {name} already exists."), format!("Database {name} sudah ada.")));
            }
            postgres::create_database(&pg, name)?;
        }
        other => {
            return Err(AppError::msg(crate::tr!(
                format!("Zefaro can't create a database for the driver {other}."),
                format!("Zefaro tidak bisa membuat database untuk driver {other}.")
            )))
        }
    }
    Ok(crate::tr!(format!("Created the database {name}."), format!("Database {name} dibuat.")))
}

/// Add the workers a site doesn't have yet (same name and command); returns how many.
fn add_workers(state: &AppState, site: &str, workers: &[ProjectWorker]) -> AppResult<usize> {
    let mut cfg = state.config.lock().unwrap();
    let mut added = 0;
    for w in workers {
        let (label, command) = (w.label.trim(), w.command.trim());
        if label.is_empty() || command.is_empty() {
            continue;
        }
        if cfg.workers.iter().any(|x| x.site == site && x.label == label && x.command == command) {
            continue;
        }
        let taken: Vec<String> = cfg.workers.iter().map(|x| x.id.clone()).collect();
        cfg.workers.push(Worker {
            id: laravel::new_worker_id(&format!("{site} {label}"), &taken),
            site: site.to_owned(),
            label: label.to_owned(),
            command: command.to_owned(),
            autostart: w.autostart,
        });
        added += 1;
    }
    crate::config::save(&cfg)?;
    Ok(added)
}

/// Write zefaro.json into the site's folder from its current settings: PHP
/// line, HTTPS, dev server port, workers, and the services and database its
/// `.env` points at on this computer. Returns the file's path.
#[tauri::command]
pub fn project_save(name: String, state: State<AppState>) -> AppResult<String> {
    let cfg = state.config.lock().unwrap().clone();
    let site = cfg
        .sites
        .iter()
        .find(|s| s.name == name)
        .ok_or_else(|| AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada.")))?;
    let folder = PathBuf::from(&site.path);
    let env = std::fs::read_to_string(folder.join(".env")).map(|t| laravel::parse_env(&t)).unwrap_or_default();
    let (services, database) = if site.proxy.is_some() {
        (Vec::new(), None)
    } else {
        project::infer_from_env(&env, cfg.mailpit.smtp_port)
    };
    let file = ProjectFile {
        name: Some(site.name.clone()),
        php: site.proxy.is_none().then(|| site.php_version.clone()),
        https: Some(site.secured),
        proxy: site.proxy,
        services,
        database,
        workers: cfg
            .workers
            .iter()
            .filter(|w| w.site == site.name)
            .map(|w| ProjectWorker { label: w.label.clone(), command: w.command.clone(), autostart: w.autostart })
            .collect(),
    };
    Ok(project::write(&folder, &file)?.display().to_string())
}
