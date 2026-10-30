//! Shared application state, managed by Tauri and injected into commands.

use crate::config::{self, ZefaroConfig};
use crate::engine::{laravel, node, php::Release, terminal, tunnel};
use crate::engine::supervisor::Supervisor;
use std::collections::HashSet;
use crate::model::{BackupJob, DbJob};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub struct AppState {
    pub config: Mutex<ZefaroConfig>,
    /// Runs nginx and the php-cgi listeners. Shared with blocking tasks and
    /// the monitor thread.
    pub supervisor: Arc<Supervisor>,
    /// Last fetched PHP release list and when it was fetched.
    pub php_releases: Mutex<Option<(Instant, Vec<Release>)>>,
    /// PHP lines currently being installed, to reject double clicks.
    pub php_installing: Mutex<HashSet<String>>,
    /// Last fetched Node.js release list and when it was fetched.
    pub node_releases: Mutex<Option<(Instant, Vec<node::Release>)>>,
    /// Node.js lines currently being installed or removed.
    pub node_busy: Mutex<HashSet<String>>,
    /// The database export/import in progress, or the last one.
    pub db_job: Arc<Mutex<Option<DbJob>>>,
    /// Set to stop the running export/import at its next chunk.
    pub db_cancel: Arc<AtomicBool>,
    /// The backup or restore in progress, or the last one.
    pub backup_job: Arc<Mutex<Option<BackupJob>>>,
    /// Set to stop the running backup or restore at its next step.
    pub backup_cancel: Arc<AtomicBool>,
    /// Composer/Laravel installs share Zefaro's COMPOSER_HOME, so run one at a time.
    pub tool_busy: Mutex<bool>,
    /// Whether Windows' NRPT rule sends `.test` lookups to Zefaro's DNS.
    /// None until the startup check finishes.
    pub dns_rule: Arc<Mutex<Option<bool>>>,
    /// Tinker sessions, one per site.
    pub tinker: laravel::Sessions,
    /// Artisan and Composer runs started from a site's page.
    pub site_jobs: laravel::Jobs,
    /// Shells open on the Terminal page.
    pub terminals: Arc<terminal::Terminals>,
    /// Sites shared on the internet through a Cloudflare tunnel.
    pub tunnels: Arc<tunnel::Tunnels>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new({
                let cfg = config::load();
                // "system" stays English until the interface reports Windows' language.
                crate::i18n::set(&cfg.language);
                cfg
            }),
            supervisor: Arc::new(Supervisor::default()),
            php_releases: Mutex::new(None),
            php_installing: Mutex::new(HashSet::new()),
            node_releases: Mutex::new(None),
            node_busy: Mutex::new(HashSet::new()),
            db_job: Arc::new(Mutex::new(None)),
            db_cancel: Arc::new(AtomicBool::new(false)),
            backup_job: Arc::new(Mutex::new(None)),
            backup_cancel: Arc::new(AtomicBool::new(false)),
            tool_busy: Mutex::new(false),
            dns_rule: Arc::new(Mutex::new(None)),
            tinker: laravel::Sessions::default(),
            site_jobs: laravel::Jobs::default(),
            terminals: Arc::default(),
            tunnels: Arc::default(),
        }
    }
}
