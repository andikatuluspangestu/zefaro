//! Backups on a schedule: when the next one is due, what the file is called,
//! and which of Zefaro's own older files go. The backup itself is the same job
//! as the Settings page's Back up button.

use crate::config::BackupSchedule;
use crate::config::config_dir;
use crate::engine::paths;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use time::{Date, OffsetDateTime, Time};

/// Every scheduled backup's file name starts with this, and only those files
/// are ever deleted to keep the count.
pub const PREFIX: &str = "zefaro-auto-";

/// What happened last, kept next to Zefaro's runtime files.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Record {
    /// When the schedule was turned on or changed: slots before it don't count.
    pub anchor_ms: u64,
    pub last_ms: Option<u64>,
    pub last_file: Option<String>,
    /// "done", "failed" or "cancelled".
    pub last_state: Option<String>,
    pub last_message: Option<String>,
    /// Older backups deleted after the last one, to keep the count.
    pub pruned: u32,
}

fn record_path() -> PathBuf {
    if cfg!(test) {
        std::env::temp_dir().join(format!("zefaro-backupsched-{}.json", std::process::id()))
    } else {
        config_dir().join("runtime").join("backup-schedule.json")
    }
}

pub fn load() -> Record {
    fs::read(record_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save(record: &Record) -> AppResult<()> {
    let path = record_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(path, serde_json::to_vec_pretty(record).unwrap_or_default())?;
    Ok(())
}

pub fn validate(s: &BackupSchedule) -> AppResult<()> {
    let ok = matches!(s.every.as_str(), "daily" | "weekly")
        && s.hour < 24
        && (1..=7).contains(&s.weekday)
        && (1..=365).contains(&s.keep);
    if !ok {
        return Err(AppError::msg(crate::tr!(
            "Those schedule settings aren't valid.",
            "Pengaturan jadwal itu tidak valid."
        )));
    }
    if !s.folder.trim().is_empty() && !Path::new(s.folder.trim()).is_absolute() {
        return Err(AppError::msg(crate::tr!(
            "Choose a full folder path for the backups.",
            "Pilih path folder lengkap untuk cadangan."
        )));
    }
    Ok(())
}

/// The folder the files go to.
pub fn folder(s: &BackupSchedule) -> PathBuf {
    let chosen = s.folder.trim();
    if chosen.is_empty() {
        dirs::document_dir().unwrap_or_else(paths::data_dir).join("Zefaro backups")
    } else {
        PathBuf::from(chosen)
    }
}

/// Now in Windows' time zone (UTC if it can't be read).
pub fn now_local() -> OffsetDateTime {
    OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc())
}

pub fn unix_ms(at: OffsetDateTime) -> u64 {
    (at.unix_timestamp_nanos() / 1_000_000).max(0) as u64
}

fn slot_on(date: Date, s: &BackupSchedule, like: OffsetDateTime) -> Option<OffsetDateTime> {
    let fits = s.every != "weekly" || date.weekday().number_from_monday() == s.weekday;
    let at = Time::from_hms(s.hour.min(23), 0, 0).ok()?;
    fits.then(|| date.with_time(at).assume_offset(like.offset()))
}

/// The latest scheduled moment at or before `now`.
pub fn last_slot(s: &BackupSchedule, now: OffsetDateTime) -> Option<OffsetDateTime> {
    let mut date = now.date();
    for _ in 0..8 {
        if let Some(at) = slot_on(date, s, now).filter(|at| *at <= now) {
            return Some(at);
        }
        date = date.previous_day()?;
    }
    None
}

/// The first scheduled moment after `now`.
pub fn next_slot(s: &BackupSchedule, now: OffsetDateTime) -> Option<OffsetDateTime> {
    let mut date = now.date();
    for _ in 0..8 {
        if let Some(at) = slot_on(date, s, now).filter(|at| *at > now) {
            return Some(at);
        }
        date = date.next_day()?;
    }
    None
}

/// A slot has passed since the schedule was set and since the last backup.
/// A slot missed while the computer was off is made up once Zefaro runs again.
pub fn is_due(s: &BackupSchedule, now: OffsetDateTime, record: &Record) -> bool {
    if !s.enabled {
        return false;
    }
    let Some(slot) = last_slot(s, now) else { return false };
    let since = record.anchor_ms.max(record.last_ms.unwrap_or(0));
    unix_ms(slot) > since
}

/// `zefaro-auto-2026-11-14-1200.zip`: sorts by time.
pub fn file_name(at: OffsetDateTime) -> String {
    format!(
        "{PREFIX}{:04}-{:02}-{:02}-{:02}{:02}.zip",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute()
    )
}

/// Delete this schedule's oldest files beyond `keep`. Files with other names
/// are never touched. Returns the ones deleted.
pub fn prune(folder: &Path, keep: u32) -> AppResult<Vec<PathBuf>> {
    let mut ours: Vec<PathBuf> = fs::read_dir(folder)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                    n.starts_with(PREFIX) && n.len() > PREFIX.len() + 4 && n.to_ascii_lowercase().ends_with(".zip")
                })
        })
        .collect();
    ours.sort();
    let extra = ours.len().saturating_sub(keep.max(1) as usize);
    let mut gone = Vec::new();
    for path in ours.into_iter().take(extra) {
        if fs::remove_file(&path).is_ok() {
            gone.push(path);
        }
    }
    Ok(gone)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    fn daily(hour: u8) -> BackupSchedule {
        BackupSchedule { enabled: true, hour, ..BackupSchedule::default() }
    }

    #[test]
    fn daily_slots_fall_on_the_hour_before_and_after_now() {
        let now = datetime!(2026-11-14 10:30 +7);
        let s = daily(12);
        assert_eq!(last_slot(&s, now), Some(datetime!(2026-11-13 12:00 +7)));
        assert_eq!(next_slot(&s, now), Some(datetime!(2026-11-14 12:00 +7)));
        let s = daily(9);
        assert_eq!(last_slot(&s, now), Some(datetime!(2026-11-14 09:00 +7)));
        assert_eq!(next_slot(&s, now), Some(datetime!(2026-11-15 09:00 +7)));
    }

    #[test]
    fn weekly_slots_land_on_the_chosen_day() {
        // 2026-11-14 is a Saturday.
        let now = datetime!(2026-11-14 10:30 +7);
        let s = BackupSchedule { every: "weekly".into(), weekday: 1, ..daily(12) };
        assert_eq!(last_slot(&s, now), Some(datetime!(2026-11-09 12:00 +7)));
        assert_eq!(next_slot(&s, now), Some(datetime!(2026-11-16 12:00 +7)));
        let s = BackupSchedule { every: "weekly".into(), weekday: 6, ..daily(8) };
        assert_eq!(last_slot(&s, now), Some(datetime!(2026-11-14 08:00 +7)));
        assert_eq!(next_slot(&s, now), Some(datetime!(2026-11-21 08:00 +7)));
    }

    #[test]
    fn due_once_per_slot_and_not_for_slots_before_the_schedule_was_set() {
        let s = daily(12);
        let set_at = datetime!(2026-11-14 13:00 +7);
        let record = Record { anchor_ms: unix_ms(set_at), ..Record::default() };
        // Today's 12:00 passed before it was turned on: wait for tomorrow.
        assert!(!is_due(&s, datetime!(2026-11-14 18:00 +7), &record));
        assert!(!is_due(&s, datetime!(2026-11-15 11:59 +7), &record));
        assert!(is_due(&s, datetime!(2026-11-15 12:00 +7), &record));
        // Made up after the computer was off at noon.
        assert!(is_due(&s, datetime!(2026-11-15 20:00 +7), &record));
        let done = Record { last_ms: Some(unix_ms(datetime!(2026-11-15 12:01 +7))), ..record.clone() };
        assert!(!is_due(&s, datetime!(2026-11-15 23:00 +7), &done));
        assert!(is_due(&s, datetime!(2026-11-16 12:00 +7), &done));
        let off = BackupSchedule { enabled: false, ..s };
        assert!(!is_due(&off, datetime!(2026-11-16 12:00 +7), &done));
    }

    #[test]
    fn file_names_sort_by_time() {
        assert_eq!(file_name(datetime!(2026-11-04 09:05 +7)), "zefaro-auto-2026-11-04-0905.zip");
        assert!(file_name(datetime!(2026-11-04 09:05 +7)) < file_name(datetime!(2026-11-10 08:00 +7)));
    }

    #[test]
    fn prune_keeps_the_newest_and_never_touches_other_files() {
        let dir = std::env::temp_dir().join(format!("zefaro-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for name in [
            "zefaro-auto-2026-11-01-1200.zip",
            "zefaro-auto-2026-11-02-1200.zip",
            "zefaro-auto-2026-11-03-1200.zip",
            "zefaro-backup-2026-10-01.zip",
            "notes.txt",
        ] {
            fs::write(dir.join(name), b"x").unwrap();
        }
        let gone = prune(&dir, 2).unwrap();
        assert_eq!(gone, [dir.join("zefaro-auto-2026-11-01-1200.zip")]);
        let mut left: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left, ["notes.txt", "zefaro-auto-2026-11-02-1200.zip", "zefaro-auto-2026-11-03-1200.zip", "zefaro-backup-2026-10-01.zip"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_the_settings() {
        assert!(validate(&daily(12)).is_ok());
        assert!(validate(&daily(24)).is_err());
        assert!(validate(&BackupSchedule { keep: 0, ..daily(1) }).is_err());
        assert!(validate(&BackupSchedule { every: "hourly".into(), ..daily(1) }).is_err());
        assert!(validate(&BackupSchedule { folder: "relative\\dir".into(), ..daily(1) }).is_err());
        assert!(validate(&BackupSchedule { folder: "D:\\Backups".into(), ..daily(1) }).is_ok());
    }
}
