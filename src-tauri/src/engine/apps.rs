//! Programs a site can be opened in: code editors, terminals and database
//! tools found on this computer. Zefaro looks in the folders their installers
//! use; nothing is configured by hand.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApp {
    /// "vscode", "phpstorm", "wt", "heidisql", …
    pub id: String,
    pub name: String,
    /// "editor" | "terminal" | "database"
    pub kind: String,
    #[serde(skip)]
    pub exe: PathBuf,
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

/// Subfolders of `dir` whose name starts with `prefix`, newest name last.
fn dirs_starting(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(prefix) && e.path().is_dir())
        .map(|e| e.path())
        .collect();
    found.sort();
    found
}

/// Where each program's installer puts it, per user and per machine.
fn candidates(id: &str) -> Vec<PathBuf> {
    let local = env_dir("LOCALAPPDATA");
    let pf = env_dir("ProgramFiles");
    let pf86 = env_dir("ProgramFiles(x86)");
    let under = |base: &Option<PathBuf>, rel: &str| base.as_ref().map(|b| b.join(rel));
    let mut out: Vec<Option<PathBuf>> = match id {
        "vscode" => vec![under(&local, r"Programs\Microsoft VS Code\Code.exe"), under(&pf, r"Microsoft VS Code\Code.exe")],
        "cursor" => vec![under(&local, r"Programs\cursor\Cursor.exe")],
        "zed" => vec![under(&local, r"Programs\Zed\Zed.exe"), under(&pf, r"Zed\Zed.exe")],
        "sublime" => vec![under(&pf, r"Sublime Text\sublime_text.exe"), under(&pf, r"Sublime Text 3\sublime_text.exe")],
        "notepadpp" => vec![under(&pf, r"Notepad++\notepad++.exe"), under(&pf86, r"Notepad++\notepad++.exe")],
        "wt" => vec![under(&local, r"Microsoft\WindowsApps\wt.exe")],
        "pwsh" => vec![under(&pf, r"PowerShell\7\pwsh.exe")],
        "gitbash" => vec![under(&pf, r"Git\git-bash.exe")],
        "heidisql" => vec![under(&pf, r"HeidiSQL\heidisql.exe"), under(&pf86, r"HeidiSQL\heidisql.exe")],
        "sqlitebrowser" => vec![under(&pf, r"DB Browser for SQLite\DB Browser for SQLite.exe")],
        _ => vec![],
    };
    if id == "phpstorm" {
        // Toolbox installs per user; the standalone installer under JetBrains.
        out.push(under(&local, r"Programs\PhpStorm\bin\phpstorm64.exe"));
        for base in [&pf, &pf86].into_iter().flatten() {
            for dir in dirs_starting(&base.join("JetBrains"), "PhpStorm").into_iter().rev() {
                out.push(Some(dir.join(r"bin\phpstorm64.exe")));
            }
        }
    }
    out.into_iter().flatten().collect()
}

const KNOWN: &[(&str, &str, &str)] = &[
    ("vscode", "VS Code", "editor"),
    ("phpstorm", "PhpStorm", "editor"),
    ("cursor", "Cursor", "editor"),
    ("zed", "Zed", "editor"),
    ("sublime", "Sublime Text", "editor"),
    ("notepadpp", "Notepad++", "editor"),
    ("wt", "Windows Terminal", "terminal"),
    ("pwsh", "PowerShell 7", "terminal"),
    ("gitbash", "Git Bash", "terminal"),
    ("heidisql", "HeidiSQL", "database"),
    ("sqlitebrowser", "DB Browser for SQLite", "database"),
];

/// Every known program found on this computer, plus the Windows command
/// prompt, which is always there.
pub fn detect() -> Vec<ExternalApp> {
    let mut apps: Vec<ExternalApp> = KNOWN
        .iter()
        .filter_map(|(id, name, kind)| {
            let exe = candidates(id).into_iter().find(|p| p.is_file())?;
            Some(ExternalApp { id: (*id).into(), name: (*name).into(), kind: (*kind).into(), exe })
        })
        .collect();
    let cmd = std::env::var_os("ComSpec").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("cmd.exe"));
    apps.push(ExternalApp { id: "cmd".into(), name: "Command Prompt".into(), kind: "terminal".into(), exe: cmd });
    apps
}

/// The database a site's .env points at, for database tools.
#[derive(Clone, Debug, PartialEq)]
pub enum Database {
    Mysql { host: String, port: u16, user: String, password: String, name: String },
    Postgres { host: String, port: u16, user: String, password: String, name: String },
    Sqlite { file: PathBuf },
}

/// Read DB_* from the site's .env entries.
pub fn database(project: &Path, env: &[(String, String)]) -> Option<Database> {
    let get = |k: &str| env.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
    match get("DB_CONNECTION").as_deref().unwrap_or("sqlite") {
        "mysql" | "mariadb" => Some(Database::Mysql {
            host: get("DB_HOST").filter(|h| !h.is_empty()).unwrap_or_else(|| "127.0.0.1".into()),
            port: get("DB_PORT").and_then(|p| p.parse().ok()).unwrap_or(3306),
            user: get("DB_USERNAME").unwrap_or_else(|| "root".into()),
            password: get("DB_PASSWORD").unwrap_or_default(),
            name: get("DB_DATABASE").unwrap_or_default(),
        }),
        "pgsql" => Some(Database::Postgres {
            host: get("DB_HOST").filter(|h| !h.is_empty()).unwrap_or_else(|| "127.0.0.1".into()),
            port: get("DB_PORT").and_then(|p| p.parse().ok()).unwrap_or(5432),
            user: get("DB_USERNAME").unwrap_or_else(|| "root".into()),
            password: get("DB_PASSWORD").unwrap_or_default(),
            name: get("DB_DATABASE").unwrap_or_default(),
        }),
        "sqlite" => {
            let file = get("DB_DATABASE")
                .filter(|v| !v.is_empty())
                .map(|v| {
                    let p = PathBuf::from(&v);
                    if p.is_absolute() { p } else { project.join(p) }
                })
                .unwrap_or_else(|| project.join("database").join("database.sqlite"));
            file.is_file().then_some(Database::Sqlite { file })
        }
        _ => None,
    }
}

/// Arguments for HeidiSQL to connect straight to the database.
pub fn heidisql_args(db: &Database) -> Vec<String> {
    match db {
        Database::Mysql { host, port, user, password, name } | Database::Postgres { host, port, user, password, name } => {
            let nettype = if matches!(db, Database::Postgres { .. }) { 8 } else { 0 };
            let mut a = vec![
                format!("--nettype={nettype}"),
                format!("--host={host}"),
                format!("--port={port}"),
                format!("--user={user}"),
                format!("--password={password}"),
            ];
            if !name.is_empty() {
                a.push(format!("--databases={name}"));
            }
            a
        }
        Database::Sqlite { file } => vec!["--nettype=10".into(), format!("--host={}", file.display())],
    }
}

/// Start a program without waiting for it. Terminals get a window of their own.
pub fn launch(app: &ExternalApp, folder: &Path, args: Vec<OsString>, path_env: &OsString) -> AppResult<()> {
    let mut cmd = Command::new(&app.exe);
    cmd.args(&args).current_dir(folder).env("PATH", path_env);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(if app.kind == "terminal" { CREATE_NEW_CONSOLE } else { DETACHED_PROCESS });
    }
    cmd.spawn().map(|_| ()).map_err(|e| {
        AppError::msg(crate::tr!(
            format!("Zefaro couldn't start {}: {e}", app.name),
            format!("Zefaro tidak dapat menjalankan {}: {e}", app.name)
        ))
    })
}

/// Arguments that open `folder` in the program.
pub fn folder_args(app: &ExternalApp, folder: &Path) -> Vec<OsString> {
    match app.id.as_str() {
        "wt" => vec!["-d".into(), folder.into()],
        "gitbash" => vec![format!("--cd={}", folder.display()).into()],
        "pwsh" => vec!["-NoExit".into()],
        "cmd" => vec!["/k".into()],
        _ => vec![folder.into()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| ((*k).into(), (*v).into())).collect()
    }

    #[test]
    fn reads_the_database_from_env() {
        let project = Path::new(r"C:\Sites\shop");
        let db = database(project, &env(&[("DB_CONNECTION", "mariadb"), ("DB_DATABASE", "shop"), ("DB_PASSWORD", "")]));
        assert_eq!(
            db,
            Some(Database::Mysql { host: "127.0.0.1".into(), port: 3306, user: "root".into(), password: String::new(), name: "shop".into() })
        );
        assert_eq!(
            heidisql_args(&db.unwrap()),
            ["--nettype=0", "--host=127.0.0.1", "--port=3306", "--user=root", "--password=", "--databases=shop"]
        );
        let pg = database(project, &env(&[("DB_CONNECTION", "pgsql"), ("DB_DATABASE", "shop")])).unwrap();
        assert_eq!(heidisql_args(&pg)[..3], ["--nettype=8", "--host=127.0.0.1", "--port=5432"]);
        assert_eq!(database(project, &env(&[("DB_CONNECTION", "sqlsrv")])), None);
        // SQLite only when the file exists.
        assert_eq!(database(project, &env(&[("DB_CONNECTION", "sqlite")])), None);
    }

    #[test]
    fn finds_the_command_prompt() {
        assert!(detect().iter().any(|a| a.id == "cmd" && a.kind == "terminal"));
    }
}
