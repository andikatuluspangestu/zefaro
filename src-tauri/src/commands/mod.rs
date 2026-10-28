//! Tauri command handlers, grouped by feature area. Registered in `lib.rs`.

pub mod certs;
pub mod db;
pub mod dns;
pub mod laravel;
pub mod logs;
pub mod mail;
pub mod new_site;
pub mod nginx;
pub mod node;
pub mod php;
pub mod services;
pub mod sites;
pub mod system;
pub mod tools;

use crate::error::{AppError, AppResult};

/// Run blocking work (network, disk, child processes) off the async runtime so
/// the UI stays responsive.
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| {
            AppError::msg(crate::tr!(
                format!("A background task failed: {e}"),
                format!("Tugas latar belakang gagal: {e}")
            ))
        })?
}
