//! The language of the text the backend writes for the interface: error
//! messages, service details, log labels.
//!
//! The interface decides the language (the user's choice in Settings, or
//! Windows' display language) and tells the backend with `set_language`. Until
//! it does, messages are in English.
//!
//! Write each message in both languages at the place it is used:
//!
//! ```ignore
//! AppError::msg(crate::tr!("That site no longer exists.", "Situs itu sudah tidak ada."))
//! AppError::msg(crate::tr!(format!("Port {port} is in use."), format!("Port {port} sedang dipakai.")))
//! ```

use std::sync::atomic::{AtomicBool, Ordering};

static INDONESIAN: AtomicBool = AtomicBool::new(false);

/// Languages the interface can be shown in.
pub const LANGUAGES: &[&str] = &["en", "id"];

/// Switches the backend's messages to `lang` ("en" or "id").
pub fn set(lang: &str) {
    INDONESIAN.store(lang == "id", Ordering::Relaxed);
}

/// Whether messages should be in Indonesian.
pub fn is_id() -> bool {
    INDONESIAN.load(Ordering::Relaxed)
}

/// The English or the Indonesian text, by the current language. Both arms must
/// have the same type (two `&str`, or two `String` from `format!`).
#[macro_export]
macro_rules! tr {
    ($en:expr, $id:expr $(,)?) => {
        if $crate::i18n::is_id() {
            $id
        } else {
            $en
        }
    };
}
