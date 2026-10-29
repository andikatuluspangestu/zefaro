//! Is there a newer Zefaro? Reads the latest release from the project's public
//! GitHub page. The request carries nothing but Zefaro's version (in its
//! User-Agent), and Zefaro never downloads or installs anything on its own: it
//! only says that a new version exists and where to get it.

use crate::engine::net;
use crate::error::AppResult;
use serde::Serialize;

const LATEST_URL: &str = "https://api.github.com/repos/andikatuluspangestu/zefaro/releases/latest";
/// Where to send people when the lookup fails or finds nothing.
pub const RELEASES_URL: &str = "https://github.com/andikatuluspangestu/zefaro/releases";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    /// The latest release's version, without the leading "v".
    pub latest: String,
    pub newer: bool,
    /// The release's page, with its installer and notes.
    pub url: String,
    /// When it was published (ISO 8601), if GitHub says.
    pub published: Option<String>,
}

/// "v1.2.3", "1.2.3" or "1.2" → (1, 2, 3). Anything after a "-" (pre-release
/// tags) is ignored for the numbers.
pub fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let core = s.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let major = parts.next()??;
    let minor = parts.next().unwrap_or(Some(0))?;
    let patch = parts.next().unwrap_or(Some(0))?;
    Some((major, minor, patch))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    matches!((parse_version(latest), parse_version(current)), (Some(l), Some(c)) if l > c)
}

/// The fields Zefaro reads from GitHub's "latest release" answer. Drafts and
/// pre-releases never come back from that endpoint.
pub fn from_release(json: &serde_json::Value, current: &str) -> Option<UpdateInfo> {
    let tag = json.get("tag_name")?.as_str()?;
    parse_version(tag)?;
    let latest = tag.trim_start_matches(['v', 'V']).to_owned();
    Some(UpdateInfo {
        newer: is_newer(&latest, current),
        current: current.to_owned(),
        url: json.get("html_url").and_then(|v| v.as_str()).unwrap_or(RELEASES_URL).to_owned(),
        published: json.get("published_at").and_then(|v| v.as_str()).map(str::to_owned),
        latest,
    })
}

pub fn check() -> AppResult<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION");
    let json: serde_json::Value = net::get_json(LATEST_URL)?;
    from_release(&json, current).ok_or_else(|| {
        crate::error::AppError::msg(crate::tr!(
            "GitHub's answer didn't name a release Zefaro understands.",
            "Jawaban GitHub tidak menyebut rilis yang dipahami Zefaro."
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn versions_compare_by_number() {
        assert_eq!(parse_version("v1.0.10"), Some((1, 0, 10)));
        assert_eq!(parse_version("2.1"), Some((2, 1, 0)));
        assert_eq!(parse_version("1.2.0-beta.1"), Some((1, 2, 0)));
        assert_eq!(parse_version("latest"), None);
        assert!(is_newer("1.0.10", "1.0.9"));
        assert!(is_newer("v1.1.0", "1.0.1"));
        assert!(!is_newer("1.0.1", "1.0.1"));
        assert!(!is_newer("1.0.0", "1.0.1"));
        assert!(!is_newer("nonsense", "1.0.1"));
    }

    #[test]
    fn reads_githubs_latest_release() {
        let release = json!({
            "tag_name": "v1.0.2",
            "html_url": "https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.0.2",
            "published_at": "2026-10-30T01:00:00Z",
        });
        let info = from_release(&release, "1.0.1").unwrap();
        assert_eq!(info.latest, "1.0.2");
        assert!(info.newer);
        assert!(info.url.ends_with("/v1.0.2"));
        assert_eq!(from_release(&release, "1.0.2").map(|i| i.newer), Some(false));
        assert_eq!(from_release(&json!({ "message": "Not Found" }), "1.0.1"), None);
    }
}
