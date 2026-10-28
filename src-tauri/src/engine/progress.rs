//! How far a service's first-start install has got: downloading, unpacking,
//! setting up. The Services page polls it to draw a progress bar on the card.
//!
//! The service being started is a thread-local, set by [`scope`], so the
//! download and unzip code reports without every installer passing an id.

use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// "download" | "extract" | "setup"
    pub phase: String,
    /// Bytes downloaded, or files unpacked.
    pub done: u64,
    /// Bytes or files in all; None when unknown.
    pub total: Option<u64>,
}

static MAP: Mutex<Option<HashMap<String, Progress>>> = Mutex::new(None);

thread_local! {
    static CURRENT: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Run `f` as the start of service `id`: progress reported inside it is the
/// service's, and cleared when `f` returns.
pub fn scope<T>(id: &str, f: impl FnOnce() -> T) -> T {
    let previous = CURRENT.with(|c| c.replace(Some(id.to_owned())));
    let result = f();
    CURRENT.with(|c| *c.borrow_mut() = previous);
    if let Some(map) = MAP.lock().unwrap().as_mut() {
        map.remove(id);
    }
    result
}

/// Report progress for the service this thread is starting, if any.
pub fn report(phase: &str, done: u64, total: Option<u64>) {
    let Some(id) = CURRENT.with(|c| c.borrow().clone()) else { return };
    MAP.lock().unwrap().get_or_insert_with(HashMap::new).insert(id, Progress { phase: phase.to_owned(), done, total });
}

/// Every install in progress, by service id.
pub fn all() -> HashMap<String, Progress> {
    MAP.lock().unwrap().clone().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_only_inside_a_scope_and_clears_after() {
        report("download", 1, Some(2));
        assert!(!all().contains_key("svc-test"));
        scope("svc-test", || {
            report("download", 5, Some(10));
            assert_eq!(all()["svc-test"], Progress { phase: "download".into(), done: 5, total: Some(10) });
            // A start inside a start (phpMyAdmin starts MariaDB) reports for itself.
            scope("svc-inner", || report("extract", 1, Some(3)));
            assert!(!all().contains_key("svc-inner"));
            report("setup", 0, None);
            assert_eq!(all()["svc-test"].phase, "setup");
        });
        assert!(!all().contains_key("svc-test"));
    }
}
