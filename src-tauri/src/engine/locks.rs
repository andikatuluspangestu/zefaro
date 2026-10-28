//! Per-key mutexes: serialize work on the same thing (installing into one
//! folder, starting one service) while different keys still run in parallel.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct KeyedLocks(Mutex<HashMap<String, Arc<Mutex<()>>>>);

impl KeyedLocks {
    /// The lock for `key`. Hold it with `gate.lock()` for the critical section;
    /// a poisoned lock is still usable since it only guards `()`.
    pub fn get(&self, key: &str) -> Arc<Mutex<()>> {
        self.0.lock().unwrap().entry(key.to_owned()).or_default().clone()
    }
}
