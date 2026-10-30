import changelog from "../../CHANGELOG.md?raw";

/** One version's entry in CHANGELOG.md. */
export interface ChangelogEntry {
  version: string;
  /** "2026-10-30", when the entry has one. */
  date: string | null;
  /** The entry's Markdown, without its `## [version]` line. */
  body: string;
}

/**
 * Splits a Keep a Changelog file into its versions, newest first as written.
 * `## [Unreleased]` is left out, and so are the `[1.0.0]: https://…` link
 * lines at the end: the notes are read inside Zefaro, not followed to a page.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { version: string; date: string | null; lines: string[] } | null = null;
  const flush = () => {
    if (current) entries.push({ version: current.version, date: current.date, body: current.lines.join("\n").trim() });
    current = null;
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const head = raw.match(/^##\s+\[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/);
    if (head) {
      flush();
      if (!/^unreleased$/i.test(head[1])) current = { version: head[1], date: head[2] ?? null, lines: [] };
      continue;
    }
    if (!current || /^\[[^\]]+\]:\s*\S+\s*$/.test(raw)) continue;
    current.lines.push(raw);
  }
  flush();
  return entries.filter((e) => e.body);
}

/** Every version Zefaro was built with, from the CHANGELOG bundled into the app. */
export const releases: ChangelogEntry[] = parseChangelog(changelog);
