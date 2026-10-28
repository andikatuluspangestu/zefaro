//! Orchestration engine, the core of Zefaro.
//!
//! This is where Zefaro does its work: install PHP builds, run php-cgi FastCGI listeners and nginx
//! under a supervisor, resolve `*.<tld>`, and run a local certificate
//! authority for HTTPS. One-time system changes ask Windows first: the `.test`
//! DNS rule through a UAC prompt, trusting the CA through Windows' own
//! certificate confirmation dialog.

pub mod applog;
pub mod apps;
pub mod archive;
pub mod cabundle;
pub mod certs;
pub mod dbio;
pub mod dns;
pub mod dumpfilter;
pub mod framework;
pub mod laravel;
pub mod locks;
pub mod logs;
pub mod mailpit;
pub mod mariadb;
pub mod net;
pub mod nginx;
pub mod node;
pub mod paths;
pub mod php;
pub mod phpmyadmin;
pub mod postgres;
pub mod process;
pub mod progress;
pub mod redis;
pub mod shims;
pub mod supervisor;
pub mod tools;
