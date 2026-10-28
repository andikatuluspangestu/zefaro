# Contributing to Zefaro

Thanks for helping. Zefaro is a free, open-source local PHP development
environment for Windows, released under the [MIT License](LICENSE). By opening a
pull request, you agree that your contribution is released under that licence
too.

Read this page before you start. Pull requests that break the rules below are
closed without review.

## What Zefaro will not accept

### No AI features

Zefaro ships no AI features of any kind, and contributions that add one will not
be merged. That includes, for example:

- chat panels, assistants, agents or "ask AI" buttons;
- code, text, config or commit-message generation by a language model;
- integrations with AI providers or model APIs (OpenAI, Anthropic, Google,
  Ollama, local models and the like), including fields for their API keys;
- MCP servers or other endpoints meant for AI agents to control Zefaro;
- downloading, bundling or running AI models;
- sending logs, code or usage data to an AI service.

Issues that ask for an AI feature are closed for the same reason.

This rule is about what the app does. It doesn't cover the editor or tools you
use to write your change, but you are responsible for every line you submit:
understand it, test it and be ready to explain it.

### No cloud features

Zefaro runs on your machine only. Don't add accounts, sign-in, sync, hosted
services, sharing tunnels, telemetry or analytics. Zefaro goes online only to
check for new versions and to download the software listed on the About page.

### Original work only

Zefaro is an independent project, not affiliated with Laravel. Write your own
code. Don't copy files, configuration, strings, icons or images from other
applications, or from anything whose licence doesn't allow it.

## Project rules

These hold for every change:

- **Local only.** Services listen on `127.0.0.1`, never on other interfaces.
- **Verified downloads.** Zefaro downloads official builds from each project's
  own source and checks them against a pinned or published SHA-256. Don't add a
  download without a checksum.
- **Ask before changing Windows.** Zefaro changes PATH, the DNS rule or the
  certificate store only when the user clicks a button for it, and Windows shows
  its own prompt where one applies.
- **Free.** Every feature is available to everyone. There is no paid tier.

## Before you start

For anything bigger than a small fix, open an issue first and describe what
you want to change. That saves you work if the change doesn't fit Zefaro.

## Set up

See [Prerequisites](README.md#prerequisites-to-run-the-desktop-app) in the
README for Rust and the Microsoft C++ Build Tools, then:

```bash
npm install
npm run tauri dev
```

## Checks

Run these before you open a pull request. Both must pass without warnings.

```bash
npm run build
```

```bash
cd src-tauri
cargo test --lib
```

Tests marked `#[ignore]` are live tests: they download software and bind real
ports. Run them only on a machine where that is fine, with
`cargo test --lib -- --ignored`.

## Style

- **Code:** match the surrounding code in naming, structure and comment
  density. Keep Rust free of warnings.
- **UI:** use the existing shadcn/ui components and Font Awesome icons. The app
  has a dark theme only, with Zefaro red as its one accent colour. Every page must
  fit an 820 x 560 window without horizontal scrolling. See
  [DESIGN.md](DESIGN.md).
- **Text in the app:** British English (colour, licence, behaviour), sentence
  case, no em or en dashes. Say who does what ("Zefaro writes php.ini"), give
  buttons the name of their action ("Export database"), and leave out marketing
  words.

## Pull requests

- Keep each pull request to one change, and explain what it does and why.
- Add screenshots for changes to the UI.
- Update the in-app documentation (`src/pages/docs/sections.tsx`) when behaviour
  changes.
- Fill in the checklist in the pull request template.

## Reporting bugs

Open an issue with:

- the Zefaro version (shown on the About page) and your Windows version;
- the steps that lead to the problem, and what you expected instead;
- the relevant lines from the Logs page, with personal details removed.

## Security issues

Don't post details of a vulnerability in a public issue. Use **Report a
vulnerability** on the repository's Security tab if it is available. If it
isn't, open an issue without the details and ask for a private contact.
