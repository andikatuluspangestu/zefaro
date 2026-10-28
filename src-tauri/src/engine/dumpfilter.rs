//! Reads a mysqldump file as it streams to `mariadb` and keeps only what Zefaro
//! should run.
//!
//! A dump made with `--databases` or `--all-databases` holds one section per
//! database, each starting with a `-- Current Database: `name`` comment, and it
//! switches database with `CREATE DATABASE` and `USE`. Run as it is, such a dump
//! writes into every database it names, `mysql` (MariaDB's own system tables)
//! included. The router drops those statements and every section except the one
//! the user chose, so everything loads into the database they picked.
//!
//! It also drops `SET GLOBAL` statements, which change the whole server, not
//! just the import.
//!
//! A dropped line becomes an empty line, so MariaDB's "at line N" still points
//! at the same line of the file.

use crate::error::{AppError, AppResult};
use memchr::memchr;

/// How many bytes of a line decide what it is. Long INSERT lines are never held.
const PREFIX: usize = 96;
/// Marker lines are short; a longer one is cut here.
const MARKER_CAP: usize = 4096;
const MARKER: &[u8] = b"-- Current Database: ";
/// Lines that never run, in any section: they switch or create databases, or
/// change server-wide settings. Exact, case-sensitive: this is how mysqldump,
/// mariadb-dump and phpMyAdmin write them.
const NEVER: &[&[u8]] = &[
    b"USE `",
    b"CREATE DATABASE ",
    b"DROP DATABASE ",
    b"/*!40000 DROP DATABASE ",
    b"SET GLOBAL ",
    b"/*!50606 SET GLOBAL ",
];

/// A database's section in a dump: its name and where it starts.
#[derive(Clone, Debug, PartialEq)]
pub struct Section {
    pub name: String,
    /// Byte offset of the `-- Current Database` line in the (decompressed) dump.
    pub offset: u64,
}

enum Mode {
    /// Only record the sections; the output is thrown away.
    Scan,
    /// Keep the named section. `None` refuses a dump that has several.
    Import(Option<String>),
}

#[derive(Clone, Copy, PartialEq)]
enum Zone {
    /// Before the first section: session settings every dump starts with.
    Header,
    Wanted,
    Skipped,
}

enum Line {
    /// At the start of a line.
    Start,
    /// Part-way through the first `PREFIX` bytes of a line.
    Deciding,
    /// The rest of a long line goes (true) or is dropped (false).
    Streaming(bool),
    /// Collecting a section marker line.
    Marker,
}

pub struct Router {
    mode: Mode,
    zone: Zone,
    line: Line,
    prefix: Vec<u8>,
    marker: Vec<u8>,
    offset: u64,
    line_start: u64,
    found: bool,
    /// "MySQL 8.4.3" or "MariaDB 11.8.9", from the dump's first comment.
    pub origin: Option<String>,
    pub sections: Vec<Section>,
}

impl Router {
    fn new(mode: Mode) -> Self {
        Router {
            mode,
            zone: Zone::Header,
            line: Line::Start,
            prefix: Vec::with_capacity(PREFIX),
            marker: Vec::new(),
            offset: 0,
            line_start: 0,
            found: false,
            origin: None,
            sections: Vec::new(),
        }
    }

    /// Records origin and sections without keeping any output.
    pub fn scan() -> Self {
        Self::new(Mode::Scan)
    }

    /// Keeps what belongs to the database `from` (or all of a dump that has no
    /// sections). Fails at the first section when `from` is `None`.
    pub fn import(from: Option<&str>) -> Self {
        Self::new(Mode::Import(from.map(str::to_owned)))
    }

    /// Bytes fed so far.
    pub fn len(&self) -> u64 {
        self.offset
    }

    /// Filters the next piece of the dump into `out`.
    pub fn feed(&mut self, mut data: &[u8], out: &mut Vec<u8>) -> AppResult<()> {
        while !data.is_empty() {
            match self.line {
                Line::Streaming(keep) => match memchr(b'\n', data) {
                    Some(i) => {
                        if keep {
                            out.extend_from_slice(&data[..=i]);
                        } else {
                            out.push(b'\n');
                        }
                        self.offset += i as u64 + 1;
                        data = &data[i + 1..];
                        self.line = Line::Start;
                    }
                    None => {
                        if keep {
                            out.extend_from_slice(data);
                        }
                        self.offset += data.len() as u64;
                        data = &[];
                    }
                },
                Line::Marker => {
                    let (end, done) = match memchr(b'\n', data) {
                        Some(i) => (i + 1, true),
                        None => (data.len(), false),
                    };
                    let room = MARKER_CAP.saturating_sub(self.marker.len());
                    self.marker.extend_from_slice(&data[..end.min(room)]);
                    self.offset += end as u64;
                    data = &data[end..];
                    if done {
                        let line = std::mem::take(&mut self.marker);
                        self.on_marker(&line, out)?;
                        self.line = Line::Start;
                    }
                }
                Line::Start | Line::Deciding => {
                    if matches!(self.line, Line::Start) {
                        self.line_start = self.offset;
                    }
                    let window = &data[..data.len().min(PREFIX - self.prefix.len())];
                    let (end, complete) = match memchr(b'\n', window) {
                        Some(i) => (i + 1, true),
                        None => (window.len(), false),
                    };
                    self.prefix.extend_from_slice(&data[..end]);
                    self.offset += end as u64;
                    data = &data[end..];
                    if complete || self.prefix.len() >= PREFIX {
                        let prefix = std::mem::take(&mut self.prefix);
                        self.decide(prefix, complete, out)?;
                    } else {
                        self.line = Line::Deciding;
                    }
                }
            }
        }
        Ok(())
    }

    /// Call once the whole dump has been fed.
    pub fn finish(&self) -> AppResult<()> {
        if let Mode::Import(Some(want)) = &self.mode {
            if !self.sections.is_empty() && !self.found {
                return Err(AppError::msg(crate::tr!(
                    format!("The dump has no database named {want}."),
                    format!("Dump ini tidak berisi database bernama {want}.")
                )));
            }
        }
        Ok(())
    }

    fn decide(&mut self, prefix: Vec<u8>, complete: bool, out: &mut Vec<u8>) -> AppResult<()> {
        if prefix.starts_with(MARKER) {
            if complete {
                self.on_marker(&prefix, out)?;
                self.line = Line::Start;
            } else {
                self.marker = prefix;
                self.line = Line::Marker;
            }
            return Ok(());
        }
        if self.origin.is_none() {
            self.origin = banner(&prefix);
        }
        let keep = self.zone != Zone::Skipped && !NEVER.iter().any(|p| prefix.starts_with(p));
        if keep {
            out.extend_from_slice(&prefix);
        } else if complete {
            out.push(b'\n');
        }
        self.line = if complete { Line::Start } else { Line::Streaming(keep) };
        Ok(())
    }

    fn on_marker(&mut self, line: &[u8], out: &mut Vec<u8>) -> AppResult<()> {
        let name = marker_name(line);
        self.sections.push(Section { name: name.clone(), offset: self.line_start });
        match &self.mode {
            Mode::Scan => self.zone = Zone::Skipped,
            Mode::Import(None) => {
                return Err(AppError::msg(crate::tr!(
                    "This dump holds several databases. Choose which one to import.",
                    "Dump ini berisi beberapa database. Pilih satu yang akan diimpor."
                )))
            }
            Mode::Import(Some(want)) => {
                let hit = *want == name;
                self.found |= hit;
                self.zone = if hit { Zone::Wanted } else { Zone::Skipped };
            }
        }
        out.push(b'\n');
        Ok(())
    }
}

/// `-- Current Database: `shop`` → `shop` (doubled backticks are one backtick).
fn marker_name(line: &[u8]) -> String {
    let text = String::from_utf8_lossy(line);
    let text = text.trim_end();
    match (text.find('`'), text.rfind('`')) {
        (Some(a), Some(b)) if b > a => text[a + 1..b].replace("``", "`"),
        _ => text[MARKER.len()..].trim().to_owned(),
    }
}

/// `-- MySQL dump 10.13  Distrib 8.4.3, for Win64` → `MySQL 8.4.3`.
fn banner(line: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(line);
    let product = if text.starts_with("-- MySQL dump") {
        "MySQL"
    } else if text.starts_with("-- MariaDB dump") {
        "MariaDB"
    } else {
        return None;
    };
    let rest = &text[text.find("Distrib ")? + "Distrib ".len()..];
    let version = rest.split(|c: char| c == ',' || c.is_whitespace()).next()?;
    let version = version.trim_end_matches("-MariaDB");
    (!version.is_empty()).then(|| format!("{product} {version}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUMP: &str = "\
-- MySQL dump 10.13  Distrib 8.4.3, for Win64 (x86_64)
--
-- Server version\t8.4.3

/*!50503 SET NAMES utf8mb4 */;
/*!50606 SET GLOBAL INNODB_STATS_AUTO_RECALC=OFF */;
--
-- Current Database: `mysql`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `mysql` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `mysql`;
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (id int);
INSERT INTO `user` VALUES (1);
--
-- Current Database: `shop`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `shop` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;

USE `shop`;
CREATE TABLE `t` (
  `id` int,
  `n` varchar(9) COLLATE utf8mb4_0900_ai_ci
);
INSERT INTO `t` VALUES (1,'USE `x`; CREATE DATABASE y; SET GLOBAL z=1;');
--
-- Current Database: `blog`
--

USE `blog`;
CREATE TABLE `posts` (id int);
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
";

    fn run(mut router: Router, text: &str, step: usize) -> AppResult<String> {
        let mut out = Vec::new();
        for piece in text.as_bytes().chunks(step) {
            router.feed(piece, &mut out)?;
        }
        router.finish()?;
        Ok(String::from_utf8(out).unwrap())
    }

    #[test]
    fn keeps_only_the_chosen_database() {
        let out = run(Router::import(Some("shop")), DUMP, usize::MAX).unwrap();
        assert!(out.contains("CREATE TABLE `t` ("), "{out}");
        assert!(out.contains("INSERT INTO `t` VALUES (1,'USE `x`; CREATE DATABASE y; SET GLOBAL z=1;');"));
        assert!(out.contains("SET NAMES utf8mb4"), "session setup is kept");
        for gone in ["`user`", "`posts`", "USE `shop`", "CREATE DATABASE /*", "SET GLOBAL INNODB", "Current Database"] {
            assert!(!out.contains(gone), "{gone} should be dropped:\n{out}");
        }
    }

    #[test]
    fn line_numbers_survive() {
        let out = run(Router::import(Some("shop")), DUMP, usize::MAX).unwrap();
        assert_eq!(out.matches('\n').count(), DUMP.matches('\n').count());
        // The line MariaDB would report for the INSERT is the same in both.
        let line_of = |s: &str| s.lines().position(|l| l.starts_with("INSERT INTO `t`")).unwrap();
        assert_eq!(line_of(&out), line_of(DUMP));
    }

    #[test]
    fn chunk_boundaries_make_no_difference() {
        let whole = run(Router::import(Some("shop")), DUMP, usize::MAX).unwrap();
        for step in [1, 2, 7, 13, 50, 96, 97, 200] {
            assert_eq!(run(Router::import(Some("shop")), DUMP, step).unwrap(), whole, "step {step}");
        }
    }

    #[test]
    fn a_dump_with_several_databases_needs_a_choice() {
        let err = run(Router::import(None), DUMP, 64).unwrap_err().to_string();
        assert!(err.contains("several databases"), "{err}");
        let err = run(Router::import(Some("nope")), DUMP, 64).unwrap_err().to_string();
        assert_eq!(err, "The dump has no database named nope.");
    }

    #[test]
    fn a_plain_dump_passes_through_except_for_use_and_global() {
        let plain = "-- MariaDB dump 10.19  Distrib 11.8.9-MariaDB, for Win64\nUSE `other`;\nSET GLOBAL max_connections=1;\nCREATE TABLE a (id int);\nINSERT INTO a VALUES (1);\n";
        let mut r = Router::import(None);
        let mut out = Vec::new();
        r.feed(plain.as_bytes(), &mut out).unwrap();
        r.finish().unwrap();
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "-- MariaDB dump 10.19  Distrib 11.8.9-MariaDB, for Win64\n\n\nCREATE TABLE a (id int);\nINSERT INTO a VALUES (1);\n"
        );
        assert_eq!(r.origin.as_deref(), Some("MariaDB 11.8.9"));
        // A name given for a dump without sections is simply not needed.
        assert!(run(Router::import(Some("whatever")), plain, 9).unwrap().contains("CREATE TABLE a"));
    }

    #[test]
    fn scan_lists_sections_with_offsets_and_the_origin() {
        let mut r = Router::scan();
        let mut sink = Vec::new();
        for piece in DUMP.as_bytes().chunks(11) {
            r.feed(piece, &mut sink).unwrap();
            sink.clear();
        }
        assert_eq!(r.origin.as_deref(), Some("MySQL 8.4.3"));
        assert_eq!(r.len(), DUMP.len() as u64);
        let names: Vec<_> = r.sections.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["mysql", "shop", "blog"]);
        for s in &r.sections {
            assert!(DUMP[s.offset as usize..].starts_with(&format!("-- Current Database: `{}`", s.name)), "{s:?}");
        }
    }

    #[test]
    fn long_lines_are_streamed_not_held() {
        let big = format!("INSERT INTO `t` VALUES ('{}');\n", "x".repeat(500_000));
        let text = format!("-- Current Database: `a`\n{big}-- Current Database: `b`\n{big}CREATE TABLE b (id int);\n");
        let kept = run(Router::import(Some("a")), &text, 4096).unwrap();
        assert_eq!(kept.matches("INSERT INTO").count(), 1);
        assert!(!kept.contains("CREATE TABLE b"));
        assert_eq!(kept.matches('\n').count(), text.matches('\n').count());
    }

    #[test]
    fn marker_names_unescape_backticks() {
        assert_eq!(marker_name(b"-- Current Database: `we``ird`\n"), "we`ird");
        assert_eq!(marker_name(b"-- Current Database: `shop_db`\r\n"), "shop_db");
    }
}
