//! `zefaro.json`: a project's Zefaro settings, kept in the project's own folder
//! so everyone on a team (or the same person on another computer) sets the
//! site up the same way. Linking a folder that has one offers to apply it;
//! the site page can write one from the site's current settings.

use crate::engine::laravel::EnvEntry;
use crate::engine::{mailpit, mariadb, mysql, postgres, redis};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "zefaro.json";

/// Services a project can ask for, by their ids on the Services page.
pub const SERVICES: &[&str] =
    &[mariadb::SERVICE_ID, mysql::SERVICE_ID, postgres::SERVICE_ID, redis::SERVICE_ID, mailpit::SERVICE_ID];

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectFile {
    /// Site name, served at `<name>.test`. The folder's name when missing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// PHP line, e.g. "8.4".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub php: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub https: Option<bool>,
    /// Forward the site to a dev server on this port (Vite, Next.js) instead
    /// of serving the folder with PHP.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<u16>,
    /// Services to start: "mariadb", "mysql", "postgresql", "redis", "mailpit".
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub services: Vec<String>,
    /// A database to create when it doesn't exist yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<ProjectDatabase>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub workers: Vec<ProjectWorker>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectDatabase {
    /// "mariadb", "mysql" or "pgsql".
    pub driver: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectWorker {
    pub label: String,
    pub command: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub autostart: bool,
}

pub fn path_in(folder: &Path) -> PathBuf {
    folder.join(FILE_NAME)
}

/// The folder's zefaro.json, or None when it has none.
pub fn read(folder: &Path) -> AppResult<Option<ProjectFile>> {
    let path = path_in(folder);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    parse(&text).map(Some)
}

pub fn parse(text: &str) -> AppResult<ProjectFile> {
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| {
        AppError::msg(crate::tr!(
            format!("{FILE_NAME} isn't valid: {e}"),
            format!("{FILE_NAME} tidak valid: {e}")
        ))
    })
}

pub fn write(folder: &Path, project: &ProjectFile) -> AppResult<PathBuf> {
    let path = path_in(folder);
    fs::write(&path, render(project))?;
    Ok(path)
}

pub fn render(project: &ProjectFile) -> String {
    let mut text = serde_json::to_string_pretty(project).unwrap_or_else(|_| "{}".into());
    text.push('\n');
    text
}

/// The services and database a Laravel app's `.env` points at Zefaro's own
/// servers for. Hosts other than this computer are someone else's servers, so
/// they're left out.
pub fn infer_from_env(env: &[EnvEntry], mailpit_port: u16) -> (Vec<String>, Option<ProjectDatabase>) {
    let get = |key: &str| env.iter().find(|e| e.key == key).map(|e| e.value.trim().to_owned()).unwrap_or_default();
    let local = |host: &str| host.is_empty() || ["127.0.0.1", "localhost", "::1"].contains(&host);
    let mut services = Vec::new();
    let mut database = None;

    let db_host = get("DB_HOST");
    match get("DB_CONNECTION").as_str() {
        // Both speak the MySQL protocol; the port tells Zefaro's two servers apart.
        "mysql" | "mariadb" if local(&db_host) => {
            let id = if get("DB_PORT") == mysql::PORT.to_string() { mysql::SERVICE_ID } else { mariadb::SERVICE_ID };
            services.push(id.to_owned());
            let name = get("DB_DATABASE");
            if !name.is_empty() {
                database = Some(ProjectDatabase { driver: id.into(), name });
            }
        }
        "pgsql" if local(&db_host) => {
            services.push(postgres::SERVICE_ID.to_owned());
            let name = get("DB_DATABASE");
            if !name.is_empty() {
                database = Some(ProjectDatabase { driver: "pgsql".into(), name });
            }
        }
        _ => {}
    }
    let uses_redis = ["CACHE_STORE", "CACHE_DRIVER", "SESSION_DRIVER", "QUEUE_CONNECTION"]
        .iter()
        .any(|k| get(k) == "redis");
    if uses_redis && local(&get("REDIS_HOST")) {
        services.push(redis::SERVICE_ID.to_owned());
    }
    if get("MAIL_MAILER") == "smtp" && local(&get("MAIL_HOST")) && get("MAIL_PORT") == mailpit_port.to_string() {
        services.push(mailpit::SERVICE_ID.to_owned());
    }
    (services, database)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::laravel::parse_env;

    #[test]
    fn round_trips_and_leaves_out_empty_fields() {
        let p = ProjectFile {
            name: Some("shop".into()),
            php: Some("8.4".into()),
            https: Some(true),
            services: vec!["mariadb".into()],
            database: Some(ProjectDatabase { driver: "mariadb".into(), name: "shop".into() }),
            workers: vec![ProjectWorker { label: "Queue".into(), command: "php artisan queue:work".into(), autostart: false }],
            ..Default::default()
        };
        let text = render(&p);
        assert!(!text.contains("proxy") && !text.contains("autostart"), "{text}");
        assert_eq!(parse(&text).unwrap(), p);
        // A BOM (Notepad) and unknown keys are fine.
        assert_eq!(parse("\u{feff}{\"php\":\"8.3\",\"later\":1}").unwrap().php.as_deref(), Some("8.3"));
        assert!(parse("{\"php\": 8.3}").is_err(), "a number isn't a PHP line");
    }

    #[test]
    fn infers_local_services_from_env() {
        let env = parse_env(
            "DB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_DATABASE=shop\nCACHE_STORE=redis\nREDIS_HOST=127.0.0.1\n\
             MAIL_MAILER=smtp\nMAIL_HOST=127.0.0.1\nMAIL_PORT=1025\n",
        );
        let (services, db) = infer_from_env(&env, 1025);
        assert_eq!(services, ["mariadb", "redis", "mailpit"]);
        assert_eq!(db, Some(ProjectDatabase { driver: "mariadb".into(), name: "shop".into() }));

        let on_mysql = parse_env("DB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_PORT=3307\nDB_DATABASE=blog\n");
        assert_eq!(
            infer_from_env(&on_mysql, 1025),
            (vec!["mysql".to_owned()], Some(ProjectDatabase { driver: "mysql".into(), name: "blog".into() }))
        );

        let remote = parse_env("DB_CONNECTION=pgsql\nDB_HOST=db.example.com\nDB_DATABASE=x\nMAIL_MAILER=log\n");
        assert_eq!(infer_from_env(&remote, 1025), (vec![], None));
        let sqlite = parse_env("DB_CONNECTION=sqlite\n");
        assert_eq!(infer_from_env(&sqlite, 1025), (vec![], None));
    }
}
