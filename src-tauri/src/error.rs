//! Error type shared by all Tauri commands.
//!
//! Commands return `AppResult<T>`; the error serializes to a plain string so
//! the frontend receives a readable message from `invoke(...)` rejections.

use serde::{Serialize, Serializer};
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Io(std::io::Error),
    Serde(serde_json::Error),
    Zip(zip::result::ZipError),
    /// A message already written in the interface's language.
    Msg(String),
}

// Display by hand (not `#[error(...)]`) so the prefixes follow the language.
impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(e) => {
                write!(f, "{}", crate::tr!(format!("File error: {e}"), format!("Kesalahan file: {e}")))
            }
            AppError::Serde(e) => {
                write!(f, "{}", crate::tr!(format!("JSON error: {e}"), format!("Kesalahan JSON: {e}")))
            }
            AppError::Zip(e) => write!(
                f,
                "{}",
                crate::tr!(format!("Archive error: {e}"), format!("Kesalahan arsip: {e}"))
            ),
            AppError::Msg(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for AppError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            AppError::Io(e) => Some(e),
            AppError::Serde(e) => Some(e),
            AppError::Zip(e) => Some(e),
            AppError::Msg(_) => None,
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serde(e)
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        AppError::Zip(e)
    }
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
