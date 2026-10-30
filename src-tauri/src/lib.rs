//! Zefaro: a free, original, Tauri-based local PHP development environment.
//!
//! Scope: sites, multi-PHP, HTTPS, databases, mail, logs and tools for Laravel
//! apps. By design there are no AI features and no cloud features.

#[macro_use]
mod i18n;
mod commands;
mod config;
mod engine;
mod error;
mod model;
mod state;
mod tray;

use state::AppState;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Entry point of `zefaro --dns`: run the DNS server; returns the exit code.
pub fn run_dns(args: &[String]) -> i32 {
    engine::dns::cli(args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Zefaro is already running (perhaps hidden in the tray): show that one.
    #[cfg(windows)]
    if !tray::single::claim() {
        return;
    }
    // Nothing can be installing yet, so leftovers of an interrupted install
    // are safe to delete.
    engine::archive::remove_stale_staging();
    let state = AppState::new();
    // Restart crashed services. The thread ends with the process; on exit the
    // services are stopped below, and their Job Objects are the safety net if
    // Zefaro itself crashes.
    let supervisor = state.supervisor.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        supervisor.tick();
    });
    // Checking the Windows DNS rule spawns PowerShell (~0.5 s): do it once in
    // the background instead of on every Services refresh.
    let tld = state.config.lock().unwrap().tld.clone();
    let dns_rule = state.dns_rule.clone();
    std::thread::spawn(move || {
        *dns_rule.lock().unwrap() = Some(engine::dns::rule_installed(&tld));
    });
    // Command-line shims for MariaDB, Redis and nginx (installs from older
    // versions of Zefaro get them too).
    let cfg = state.config.lock().unwrap().clone();
    let workers = state.supervisor.clone();
    std::thread::spawn(move || {
        // A "start with Windows" entry that points at an old location now starts this copy.
        engine::startup::repair();
        engine::shims::refresh(&cfg);
        // php.ini managed blocks written by older Zefaro versions (e.g. before
        // mail() went to Mailpit). Nothing is running yet, so no restarts.
        engine::cabundle::rebuild();
        engine::php::refresh_inis(&cfg);
        // The services the user ticked, then the workers that need them.
        engine::startup::start_services(&cfg, &workers);
        commands::laravel::autostart(&cfg, &workers);
        // The dump receiver, when the Dumps page has it on.
        if cfg.dumps {
            if let Ok(spec) = engine::dumps::spec(&cfg) {
                let _ = workers.start(spec);
            }
        }
        // Mozilla's CA list goes stale; download it again after a month.
        engine::cabundle::refresh_if_stale();
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            tray::create(app.handle())?;
            // The window starts hidden (tauri.conf.json): shown now, unless Windows
            // started Zefaro at sign-in, when it waits in the tray.
            if !std::env::args().any(|a| a == engine::startup::BACKGROUND_ARG) {
                tray::show_main(app.handle());
            }
            #[cfg(windows)]
            {
                let handle = app.handle().clone();
                tray::single::listen(move || tray::show_main(&handle));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // The close button hides Zefaro to the tray; services keep running.
            // The first time, the interface asks what the user wants instead.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let (to_tray, asked) = {
                    let cfg = state.config.lock().unwrap();
                    (cfg.close_to_tray, cfg.close_asked)
                };
                if !asked {
                    api.prevent_close();
                    let _ = window.emit("zefaro://close-asked", ());
                } else if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::sites::list_sites,
            commands::sites::link_site,
            commands::project::project_read,
            commands::project::project_link,
            commands::project::project_save,
            commands::doctor::doctor_run,
            commands::php::php_xdebug_set,
            commands::php::php_xdebug_version,
            commands::dumps::dumps_status,
            commands::dumps::dumps_set_enabled,
            commands::dumps::dumps_list,
            commands::dumps::dumps_clear,
            commands::doctor::import_scan,
            commands::doctor::import_link,
            commands::doctor::import_db_status,
            commands::doctor::import_db_dump,
            commands::doctor::import_db_load,
            commands::sites::unlink_site,
            commands::sites::secure_site,
            commands::sites::set_site_php,
            commands::php::php_versions,
            commands::php::php_lines,
            commands::php::php_install,
            commands::php::php_activate,
            commands::php::php_settings,
            commands::php::php_save_limits,
            commands::php::php_ini_text,
            commands::php::php_extensions,
            commands::php::php_save_extensions,
            commands::php::php_reveal_ini,
            commands::php::php_save_base_port,
            commands::php::php_ca_bundle,
            commands::php::php_ca_bundle_update,
            commands::node::node_versions,
            commands::node::node_install,
            commands::node::node_activate,
            commands::node::node_uninstall,
            commands::tools::tools_status,
            commands::system::check_update,
            commands::system::update_install,
            commands::system::update_progress,
            commands::system::set_check_updates,
            commands::tools::tools_active_php,
            commands::tools::tools_bin_on_path,
            commands::tools::tools_install_composer,
            commands::tools::tools_install_laravel,
            commands::tools::path_add_bin,
            commands::terminal::terminal_shells,
            commands::terminal::terminal_list,
            commands::terminal::terminal_open,
            commands::terminal::terminal_attach,
            commands::terminal::terminal_detach,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::services::list_services,
            commands::services::start_service,
            commands::services::stop_service,
            commands::services::service_progress,
            commands::certs::ca_status,
            commands::certs::ca_trust,
            commands::certs::ca_untrust,
            commands::certs::ca_reveal,
            commands::nginx::nginx_settings,
            commands::nginx::nginx_port_status,
            commands::nginx::nginx_save_settings,
            commands::nginx::nginx_config_text,
            commands::nginx::nginx_reveal_config,
            commands::mail::mail_status,
            commands::mail::mail_list,
            commands::mail::mail_get,
            commands::mail::mail_inline_images,
            commands::mail::mail_headers,
            commands::mail::mail_raw,
            commands::mail::mail_set_read,
            commands::mail::mail_delete,
            commands::mail::mail_save_settings,
            commands::mail::mail_start,
            commands::db::db_overview,
            commands::db::db_create,
            commands::db::db_drop,
            commands::db::db_name_from_file,
            commands::db::disk_free,
            commands::db::db_job,
            commands::db::db_job_cancel,
            commands::db::db_job_dismiss,
            commands::db::db_export,
            commands::db::db_import,
            commands::db::db_scan_dump,
            commands::db::db_reveal,
            commands::db::db_default_dir,
            commands::new_site::new_site_defaults,
            commands::new_site::new_site_check,
            commands::new_site::new_site_create,
            commands::laravel::site_info,
            commands::laravel::site_open_targets,
            commands::laravel::site_open,
            commands::laravel::site_logs,
            commands::laravel::site_log_read,
            commands::laravel::site_log_clear,
            commands::laravel::site_overview,
            commands::laravel::site_tables,
            commands::laravel::site_rows,
            commands::laravel::site_update_cell,
            commands::laravel::site_delete_row,
            commands::laravel::site_config,
            commands::laravel::site_routes,
            commands::laravel::site_env,
            commands::laravel::site_env_example,
            commands::laravel::site_packages,
            commands::tunnel::tunnel_setup,
            commands::tunnel::tunnel_list,
            commands::tunnel::tunnel_start,
            commands::tunnel::tunnel_status,
            commands::tunnel::tunnel_stop,
            commands::laravel::site_env_set,
            commands::laravel::tinker_eval,
            commands::laravel::tinker_reset,
            commands::laravel::tinker_stop,
            commands::laravel::artisan_commands,
            commands::laravel::site_job_run,
            commands::laravel::site_job_output,
            commands::laravel::site_jobs,
            commands::laravel::site_job_stop,
            commands::laravel::workers_list,
            commands::laravel::worker_save,
            commands::laravel::worker_remove,
            commands::laravel::worker_start,
            commands::laravel::worker_stop,
            commands::dns::dns_setup,
            commands::dns::dns_remove,
            commands::dns::dns_settings,
            commands::dns::dns_test,
            commands::dns::dns_flush_cache,
            commands::dns::dns_set_tld,
            commands::logs::list_logs,
            commands::logs::tail_log,
            commands::logs::clear_log,
            commands::logs::reveal_log,
            commands::system::app_info,
            commands::system::set_language,
            commands::system::set_close_to_tray,
            commands::system::set_start_with_windows,
            commands::system::set_autostart,
            commands::backup::backup_inspect,
            commands::backup::backup_start,
            commands::backup::restore_start,
            commands::backup::backup_job,
            commands::backup::backup_cancel,
            commands::backup::backup_dismiss,
            commands::system::config_pending,
            commands::system::close_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Zefaro")
        .run(move |app, event| {
            if let tauri::RunEvent::Exit = event {
                commands::system::stop_everything(&app.state::<AppState>());
            }
        });
}
