//! Background services: list with live status, start and stop.

use super::blocking;
use crate::config::{self, ZefaroConfig};
use crate::engine::supervisor::{self, Health, Supervisor};
use crate::engine::{dns, mailpit, mariadb, mysql, nginx, node, paths, php, phpmyadmin, postgres, redis, shims};
use crate::error::{AppError, AppResult};
use crate::model::Service;
use crate::state::AppState;
use tauri::State;

fn base(id: &str, name: String, category: &str, port: Option<u16>, detail: String) -> Service {
    Service {
        id: id.into(),
        name,
        category: category.into(),
        status: "stopped".into(),
        port,
        pid: None,
        available: true,
        needs_install: false,
        detail: Some(detail),
        error: None,
        setup: None,
        setup_done: false,
        url: None,
        tool: false,
    }
}

/// Node.js isn't a process: "running" means a version is active on the
/// command line.
fn node_service(cfg: &ZefaroConfig) -> Service {
    let installed = node::installed();
    let mut s = base(node::SERVICE_ID, "Node.js".into(), "core", None, String::new());
    s.tool = true;
    match installed.get(&cfg.node_default) {
        Some(version) => {
            s.status = "running".into();
            s.detail = Some(format!("Node.js {version} · node, npm, npx"));
        }
        None if installed.is_empty() => {
            s.needs_install = true;
            s.detail = Some(crate::tr!("Not installed · node, npm and npx", "Belum terpasang · node, npm dan npx").into());
        }
        None => s.detail = Some(crate::tr!("No active version", "Tidak ada versi aktif").into()),
    }
    s
}

/// A process run by the supervisor; status comes from it.
fn supervised(
    sup: &Supervisor,
    id: &str,
    name: String,
    category: &str,
    port: u16,
    detail: String,
    needs_install: bool,
) -> Service {
    let st = sup.status(id);
    let mut s = base(id, name, category, Some(port), detail);
    s.pid = st.pid;
    s.needs_install = needs_install;
    (s.status, s.error) = match st.health {
        Health::Running => ("running".into(), None),
        Health::Starting => ("starting".into(), None),
        Health::Stopped => ("stopped".into(), None),
        Health::Failed(reason) => ("error".into(), Some(reason)),
    };
    s
}

fn installed_php_lines() -> Vec<String> {
    let mut lines: Vec<String> = php::installed().into_keys().collect();
    lines.sort_by(|a, b| php::minor_key(b).cmp(&php::minor_key(a)));
    lines
}

/// phpMyAdmin isn't a process: it's "running" when enabled and everything it
/// needs (nginx, its PHP line's php-cgi, MariaDB) is running.
fn phpmyadmin_service(cfg: &ZefaroConfig, sup: &Supervisor) -> Service {
    let line = phpmyadmin::pick_php(&installed_php_lines());
    let detail = match &line {
        Some(l) if phpmyadmin::is_experimental(l) => crate::tr!(
            format!("phpMyAdmin {} · PHP {l} (experimental) · signs in as root", phpmyadmin::VERSION),
            format!("phpMyAdmin {} · PHP {l} (eksperimental) · masuk sebagai root", phpmyadmin::VERSION)
        ),
        Some(l) => crate::tr!(
            format!("phpMyAdmin {} · PHP {l} · signs in as root", phpmyadmin::VERSION),
            format!("phpMyAdmin {} · PHP {l} · masuk sebagai root", phpmyadmin::VERSION)
        ),
        None => crate::tr!(
            format!("phpMyAdmin {} · needs PHP {}", phpmyadmin::VERSION, phpmyadmin::PHP_RANGE),
            format!("phpMyAdmin {} · perlu PHP {}", phpmyadmin::VERSION, phpmyadmin::PHP_RANGE_ID)
        ),
    };
    let mut s = base(phpmyadmin::SERVICE_ID, "phpMyAdmin".into(), "database", None, detail);
    s.needs_install = !phpmyadmin::installed_at(&phpmyadmin::dir());
    if s.needs_install {
        s.detail = Some(crate::tr!(
            format!("phpMyAdmin {} · {} MB download", phpmyadmin::VERSION, phpmyadmin::DOWNLOAD_MB),
            format!("phpMyAdmin {} · unduhan {} MB", phpmyadmin::VERSION, phpmyadmin::DOWNLOAD_MB)
        ));
    }
    s.url = Some(cfg.url_for(&format!("{}.{}", phpmyadmin::HOST, cfg.tld), false));
    if cfg.phpmyadmin {
        let missing: Vec<String> = match &line {
            None => vec![crate::tr!(
                format!("PHP {} (install it from Services → Install PHP)", phpmyadmin::PHP_RANGE),
                format!("PHP {} (instal dari Layanan → Instal PHP)", phpmyadmin::PHP_RANGE_ID)
            )],
            Some(l) => [
                (nginx::SERVICE_ID.to_string(), "nginx".to_string()),
                (php::service_id(l), format!("PHP {l}")),
                (mariadb::SERVICE_ID.to_string(), "MariaDB".to_string()),
            ]
            .into_iter()
            .filter(|(id, _)| sup.status(id).health != Health::Running)
            .map(|(_, name)| name)
            .collect(),
        };
        if missing.is_empty() {
            s.status = "running".into();
        } else {
            s.status = "error".into();
            s.error = Some(crate::tr!(
                format!("Needs {} running.", missing.join(", ")),
                format!("{} harus berjalan.", missing.join(", "))
            ));
        }
    }
    s
}

/// Core (nginx, one php-cgi per installed PHP line, DNS), then databases
/// (MariaDB, MySQL, Redis, PostgreSQL, phpMyAdmin), then Mailpit.
/// `dns_rule`: whether the Windows rule for the TLD exists (None = unknown yet).
pub fn list(cfg: &ZefaroConfig, sup: &Supervisor, dns_rule: Option<bool>) -> Vec<Service> {
    let mut out = vec![supervised(
        sup,
        nginx::SERVICE_ID,
        "nginx".into(),
        "core",
        cfg.nginx.http_port,
        format!("nginx {}", nginx::VERSION),
        !nginx::installed(),
    )];

    for minor in installed_php_lines() {
        let role = if minor == cfg.default_php {
            crate::tr!("php-cgi · active", "php-cgi · aktif")
        } else {
            "php-cgi"
        };
        out.push(supervised(
            sup,
            &php::service_id(&minor),
            format!("PHP {minor}"),
            "core",
            php::port_for(cfg.php.base_port, &minor),
            role.into(),
            false,
        ));
    }

    out.push(node_service(cfg));

    let tld = &cfg.tld;
    if !dns::needs_rule(tld) {
        // `.localhost` needs no Windows rule and no name server. The card stays, with
        // nothing to start, so the DNS settings (and the way back to `.test`) stay reachable.
        let mut s = base(
            dns::SERVICE_ID,
            format!("DNS (*.{tld})"),
            "core",
            None,
            crate::tr!(
                format!("Not needed: browsers open *.{tld} names themselves."),
                format!("Tidak perlu: browser membuka nama *.{tld} sendiri.")
            ),
        );
        s.tool = true;
        s.status = "running".into();
        out.push(s);
    } else {
        let mut dns_service = supervised(
            sup,
            dns::SERVICE_ID,
            format!("DNS (*.{tld})"),
            "core",
            dns::PORT,
            crate::tr!(format!("Answers *.{tld} with 127.0.0.1"), format!("Menjawab *.{tld} dengan 127.0.0.1")),
            false,
        );
        dns_service.setup = (dns_rule == Some(false)).then(|| {
            crate::tr!(
                format!("Windows doesn't send *.{tld} lookups to Zefaro yet. The one-time setup needs admin rights."),
                format!("Windows belum meneruskan pencarian *.{tld} ke Zefaro. Pengaturan satu kali ini perlu hak admin.")
            )
        });
        dns_service.setup_done = dns_rule == Some(true);
        out.push(dns_service);
    }

    let mdb = mariadb::Layout::standard();
    let mdb_installed = mariadb::installed(&mdb);
    out.push(supervised(
        sup,
        mariadb::SERVICE_ID,
        "MariaDB".into(),
        "database",
        mariadb::PORT,
        if mdb_installed {
            crate::tr!(
                format!("MariaDB {} LTS · user root, no password", mariadb::VERSION),
                format!("MariaDB {} LTS · pengguna root, tanpa kata sandi", mariadb::VERSION)
            )
        } else {
            crate::tr!(
                format!("MariaDB {} LTS · {} MB download", mariadb::VERSION, mariadb::DOWNLOAD_MB),
                format!("MariaDB {} LTS · unduhan {} MB", mariadb::VERSION, mariadb::DOWNLOAD_MB)
            )
        },
        !mdb_installed,
    ));

    let my = mysql::Layout::standard();
    let my_installed = mysql::installed(&my);
    out.push(supervised(
        sup,
        mysql::SERVICE_ID,
        "MySQL".into(),
        "database",
        mysql::PORT,
        if my_installed {
            crate::tr!(
                format!("MySQL {} LTS · user root, no password", mysql::VERSION),
                format!("MySQL {} LTS · pengguna root, tanpa kata sandi", mysql::VERSION)
            )
        } else {
            crate::tr!(
                format!("MySQL {} LTS · {} MB download", mysql::VERSION, mysql::DOWNLOAD_MB),
                format!("MySQL {} LTS · unduhan {} MB", mysql::VERSION, mysql::DOWNLOAD_MB)
            )
        },
        !my_installed,
    ));

    let rds = redis::Layout::standard();
    let rds_installed = redis::installed(&rds);
    out.push(supervised(
        sup,
        redis::SERVICE_ID,
        "Redis".into(),
        "database",
        redis::PORT,
        if rds_installed {
            format!("Redis {}", redis::VERSION)
        } else {
            crate::tr!(
                format!("Redis {} · {} MB download", redis::VERSION, redis::DOWNLOAD_MB),
                format!("Redis {} · unduhan {} MB", redis::VERSION, redis::DOWNLOAD_MB)
            )
        },
        !rds_installed,
    ));

    let pg = postgres::Layout::standard();
    let pg_installed = postgres::installed(&pg);
    out.push(supervised(
        sup,
        postgres::SERVICE_ID,
        "PostgreSQL".into(),
        "database",
        postgres::PORT,
        if pg_installed {
            crate::tr!(
                format!("PostgreSQL {} · user {}, no password", postgres::VERSION, postgres::USER),
                format!("PostgreSQL {} · pengguna {}, tanpa kata sandi", postgres::VERSION, postgres::USER)
            )
        } else {
            crate::tr!(
                format!("PostgreSQL {} · {} MB download", postgres::VERSION, postgres::DOWNLOAD_MB),
                format!("PostgreSQL {} · unduhan {} MB", postgres::VERSION, postgres::DOWNLOAD_MB)
            )
        },
        !pg_installed,
    ));

    out.push(phpmyadmin_service(cfg, sup));

    let mp = mailpit::Layout::standard(&cfg.mailpit);
    let mp_installed = mailpit::installed(&mp);
    let mut mail = supervised(
        sup,
        mailpit::SERVICE_ID,
        "Mailpit".into(),
        "mail",
        cfg.mailpit.smtp_port,
        if mp_installed {
            format!("Mailpit {} · SMTP 127.0.0.1:{}", mailpit::VERSION, cfg.mailpit.smtp_port)
        } else {
            crate::tr!(
                format!("Mailpit {} · {} MB download", mailpit::VERSION, mailpit::DOWNLOAD_MB),
                format!("Mailpit {} · unduhan {} MB", mailpit::VERSION, mailpit::DOWNLOAD_MB)
            )
        },
        !mp_installed,
    );
    if mail.status == "running" {
        mail.url = Some(super::mail::web_url(cfg, sup));
    }
    out.push(mail);
    out
}

/// Point a port conflict on nginx at the setting that resolves it.
fn port_hint(e: AppError, port: u16) -> AppError {
    match e {
        AppError::Msg(m) if m.contains(&format!("Port {port} ")) => AppError::msg(crate::tr!(
            format!("{m} Or change nginx's HTTP port with the gear on the nginx card."),
            format!("{m} Atau ganti port HTTP nginx lewat ikon roda gigi di kartu nginx.")
        )),
        other => other,
    }
}

/// Start one service, installing it on first use. phpMyAdmin also starts what
/// it needs: MariaDB, its PHP line's php-cgi, and nginx. The caller must have
/// set `cfg.phpmyadmin` already.
pub fn start(cfg: &ZefaroConfig, sup: &Supervisor, id: &str) -> AppResult<()> {
    crate::engine::progress::scope(id, || start_inner(cfg, sup, id))
}

/// Install progress of services being started, by id (Services page).
#[tauri::command]
pub fn service_progress() -> std::collections::HashMap<String, crate::engine::progress::Progress> {
    crate::engine::progress::all()
}

fn start_inner(cfg: &ZefaroConfig, sup: &Supervisor, id: &str) -> AppResult<()> {
    let downloads = paths::downloads_dir();
    match id {
        nginx::SERVICE_ID => {
            if !nginx::installed() {
                nginx::install()?;
            }
            let l = nginx::Layout::standard(cfg);
            // The supervisor checks the HTTP port; secured sites need HTTPS's too.
            if cfg.sites.iter().any(|s| s.secured)
                && !sup.is_running(nginx::SERVICE_ID)
                && supervisor::port_open(l.https_port)
            {
                let conflict = supervisor::port_conflict(l.https_port, false);
                return Err(AppError::msg(crate::tr!(
                    format!("{conflict} Or change nginx's HTTPS port with the gear on the nginx card."),
                    format!("{conflict} Atau ganti port HTTPS nginx lewat ikon roda gigi di kartu nginx.")
                )));
            }
            nginx::write_config(cfg, &l)?;
            nginx::test_config(&l)?;
            // Each site's PHP first, so nginx never proxies to a port nobody
            // serves (a 502). A PHP that won't start doesn't hold nginx back.
            let mut php_error = None;
            for line in nginx::site_php_lines(cfg) {
                let started = sup.start(php::cgi_spec(&line, php::port_for(cfg.php.base_port, &line)));
                if let Err(e) = started {
                    php_error.get_or_insert(crate::tr!(
                        format!("nginx is running, but PHP {line} didn't start: {e}"),
                        format!("nginx berjalan, tetapi PHP {line} gagal dimulai: {e}")
                    ));
                }
            }
            sup.start(nginx::spec(&l)).map_err(|e| port_hint(e, cfg.nginx.http_port))?;
            if let Some(msg) = php_error {
                return Err(AppError::msg(msg));
            }
        }
        dns::SERVICE_ID => {
            if !dns::needs_rule(&cfg.tld) {
                return Err(AppError::msg(crate::tr!(
                    "DNS has nothing to do with .localhost: browsers open those names themselves.",
                    "DNS tidak diperlukan untuk .localhost: browser membuka nama itu sendiri."
                )));
            }
            sup.start(dns::spec(&cfg.tld)?)?;
        }
        node::SERVICE_ID => {
            return Err(AppError::msg(crate::tr!(
                "Node.js has nothing to start. It runs when you use node or npm; manage its versions with the gear.",
                "Node.js tidak perlu dimulai. Node.js berjalan saat Anda memakai node atau npm; atur versinya lewat ikon roda gigi.",
            )));
        }
        mariadb::SERVICE_ID => {
            let l = mariadb::Layout::standard();
            mariadb::prepare(&l, &downloads, false)?;
            sup.start(mariadb::spec(&l))?;
        }
        mysql::SERVICE_ID => {
            let l = mysql::Layout::standard();
            mysql::prepare(&l, &downloads, false)?;
            sup.start(mysql::spec(&l))?;
        }
        redis::SERVICE_ID => {
            let l = redis::Layout::standard();
            redis::prepare(&l, &downloads, false)?;
            sup.start(redis::spec(&l))?;
        }
        postgres::SERVICE_ID => {
            let l = postgres::Layout::standard();
            postgres::prepare(&l, &downloads, false)?;
            sup.start(postgres::spec(&l))?;
        }
        mailpit::SERVICE_ID => {
            let l = mailpit::Layout::standard(&cfg.mailpit);
            mailpit::prepare(&l, &downloads, false)?;
            // The supervisor checks the UI port; SMTP is the one apps use.
            if !sup.is_running(mailpit::SERVICE_ID) && supervisor::port_open(cfg.mailpit.smtp_port) {
                let conflict = supervisor::port_conflict(cfg.mailpit.smtp_port, false);
                return Err(AppError::msg(crate::tr!(
                    format!("{conflict} Or change Mailpit's SMTP port with the gear on its card."),
                    format!("{conflict} Atau ganti port SMTP Mailpit lewat ikon roda gigi di kartunya.")
                )));
            }
            sup.start(mailpit::spec(&l))?;
            // A first install adds mailpit.<tld> to nginx.
            nginx::sync(cfg, sup)?;
        }
        phpmyadmin::SERVICE_ID => {
            let line = phpmyadmin::pick_php(&installed_php_lines()).ok_or_else(|| {
                AppError::msg(crate::tr!(
                    format!(
                        "phpMyAdmin {} needs PHP {}. Install one from Services → Install PHP.",
                        phpmyadmin::VERSION,
                        phpmyadmin::PHP_RANGE
                    ),
                    format!(
                        "phpMyAdmin {} perlu PHP {}. Instal dari Layanan → Instal PHP.",
                        phpmyadmin::VERSION,
                        phpmyadmin::PHP_RANGE_ID
                    )
                ))
            })?;
            phpmyadmin::prepare(&phpmyadmin::dir(), mariadb::PORT, &downloads, false)?;
            start(cfg, sup, mariadb::SERVICE_ID)?;
            start(cfg, sup, &php::service_id(&line))?;
            // Starts nginx with the phpMyAdmin site, or reloads it if running.
            start(cfg, sup, nginx::SERVICE_ID)?;
            nginx::sync(cfg, sup)?;
        }
        _ => {
            if let Some(minor) = id.strip_prefix("php-") {
                if !php::is_installed(minor) {
                    return Err(AppError::msg(crate::tr!(
                        format!("PHP {minor} isn't installed."),
                        format!("PHP {minor} belum terpasang.")
                    )));
                }
                sup.start(php::cgi_spec(minor, php::port_for(cfg.php.base_port, minor)))?;
            } else {
                return Err(AppError::msg(crate::tr!(
                    format!("{id} isn't available yet."),
                    format!("{id} belum tersedia.")
                )));
            }
        }
    }
    // A first start installs the program; give it its command-line shims.
    shims::refresh(cfg);
    Ok(())
}

/// Restart every running php-cgi with its current spec (port, php.ini) and
/// regenerate nginx — after the base port or the active version changes.
pub fn refresh_php(cfg: &ZefaroConfig, sup: &Supervisor) -> AppResult<()> {
    for id in sup.running_ids() {
        if let Some(minor) = id.strip_prefix("php-") {
            sup.restart(php::cgi_spec(minor, php::port_for(cfg.php.base_port, minor)))?;
        }
    }
    nginx::sync(cfg, sup)
}

/// Turn phpMyAdmin's site on or off in the saved config; returns the snapshot.
fn set_phpmyadmin(state: &AppState, enabled: bool) -> AppResult<ZefaroConfig> {
    let snapshot = {
        let mut cfg = state.config.lock().unwrap();
        cfg.phpmyadmin = enabled;
        cfg.clone()
    };
    config::save(&snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn list_services(state: State<AppState>) -> AppResult<Vec<Service>> {
    let cfg = state.config.lock().unwrap().clone();
    let dns_rule = *state.dns_rule.lock().unwrap();
    Ok(list(&cfg, &state.supervisor, dns_rule))
}

#[tauri::command]
pub async fn start_service(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let enabling = id == phpmyadmin::SERVICE_ID;
    let cfg = if enabling {
        set_phpmyadmin(&state, true)?
    } else {
        state.config.lock().unwrap().clone()
    };
    let sup = state.supervisor.clone();
    let result = blocking(move || start(&cfg, &sup, &id)).await;
    if enabling && result.is_err() {
        // Don't leave a half-enabled site behind (e.g. no supported PHP).
        set_phpmyadmin(&state, false)?;
    }
    result
}

#[tauri::command]
pub async fn stop_service(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let sup = state.supervisor.clone();
    if id == phpmyadmin::SERVICE_ID {
        // Just drop its site; nginx, PHP and MariaDB keep serving everything else.
        let cfg = set_phpmyadmin(&state, false)?;
        return blocking(move || nginx::sync(&cfg, &sup)).await;
    }
    blocking(move || sup.stop(&id)).await
}
