# Changelog

All notable changes to Zefaro are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Zefaro uses
[Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-29

### Fixed

- **502 Bad Gateway on a site after starting nginx or phpMyAdmin.** Starting nginx, or
  phpMyAdmin (which starts nginx), now also starts the PHP version each linked site uses.
  Before, a site on PHP 8.4 answered 502 until you started PHP 8.4 yourself, because only
  phpMyAdmin's own PHP came up. If one of those PHP versions can't start, nginx still
  starts and the message names the version.

### Changed

- **phpMyAdmin on PHP 8.4 and 8.5.** phpMyAdmin 5.2.3 officially supports PHP 7.2 to 8.3.
  It still runs on the newest installed version in that range. When none is installed,
  Zefaro now runs it on PHP 8.4, then 8.5, as an experiment, and the Services card says
  "experimental". Deprecation notices from phpMyAdmin's own code are hidden through a
  `.user.ini` in its folder, so they don't affect your sites. Pages, SQL queries and exports
  worked on PHP 8.4; PHP 8.5 hasn't been tested yet.
- The documentation and the website describe the phpMyAdmin PHP versions accordingly.

## [1.0.0] - 2026-10-28

The first release under the name Zefaro, "Yet Another Local Laravel Tools": a free, open-source local PHP
development environment for Windows.

### Added

- **Home page.** The first page shows which services run (with a button to start them
  all), your sites with a button to open each in the browser, and what needs attention: a
  service that failed to start, the `.test` DNS rule, an untrusted certificate, or Zefaro's
  folder missing from PATH. A fresh install gets a four-step "Get started" list instead.
- **Light and dark themes** in the Zefaro palette (coral, pink, violet and indigo). Zefaro
  follows Windows by default; Settings, under Appearance, lets you pick either. Status
  colours (success, warning, information) change with the theme so they stay readable.
- **Sites.** Link a folder and Zefaro serves it at `name.test`, subdomains included, on
  the PHP version you choose. A `public/` folder becomes the document root. The Sites
  page shows what each folder holds: Laravel, Symfony, WordPress, Drupal, Craft CMS,
  Magento and others. Linking a site, or turning HTTPS on or off, updates `APP_URL` in
  its `.env` when that still holds `localhost` or a `.test` address.
- **New site wizard.** Makes a Laravel app with the Laravel installer: plain Laravel or
  the React, Vue, Livewire, Svelte or a community starter kit, SQLite, MariaDB or
  PostgreSQL (Zefaro creates the database), Pest or PHPUnit, an optional front end build,
  Git and HTTPS. Zefaro links the site and sets `APP_URL`, mail and database values in
  `.env`. Laravel Boost is never installed.
- **Site tools.** Each Laravel site has a page with seven tabs:
  - **Overview** shows versions, environment, drivers and state, and fixes common
    problems with a button: missing app key, unreachable database, pending migrations,
    mail not reaching Mailpit, wrong `APP_URL`, missing storage link, debug mode in
    production, cached config and a queue with no worker.
  - **Data** browses the app's tables with search, sort, filters and paging. It is
    read-only until you allow changes, and secrets show as dots. It can copy the query on
    screen as Eloquent code or open it in Tinker.
  - **Configuration** edits `.env` and lists the values the app sees through `config()`
    and every route.
  - **Logs** reads `storage/logs`: entries newest first, level filters, search, context
    and stack traces, following new entries, and clearing.
  - **Tinker** runs PHP in a session that keeps its variables between runs. Results appear
    as an expandable tree, with output, `dump()`, errors, SQL queries with timing, and an
    option to roll back database changes after each run.
  - **Artisan** lists the app's commands and builds a form from each one's arguments and
    options. Commands that delete data ask first.
  - **Workers** keeps queue workers, the scheduler, Vite or any command running for the
    site, restarts them if they crash, and can start them with Zefaro.
- **Open in.** Buttons open a site in the editors, terminals and database tools found on
  the computer: VS Code, PhpStorm, Cursor, Zed, Sublime Text, Notepad++, Windows Terminal,
  PowerShell 7, Git Bash, the command prompt, HeidiSQL, DB Browser for SQLite and
  phpMyAdmin. Terminals start with the site's PHP version first on the path.
- **HTTPS.** One click per site, from Zefaro's own local certificate authority, which can
  only sign for `.test` names. Its key is encrypted for your Windows account, and you
  trust it in Windows' own confirmation dialog. PHP trusts it too, so one local site can
  call another over HTTPS. Zefaro downloads Mozilla's list of trusted authorities again
  every 30 days; the PHP page shows when and can update it now.
- **PHP.** Versions 7.4 to 8.5 side by side, from the official Windows builds, each with
  its own limits and a switch for every extension it ships. Composer and the Laravel
  installer live in Zefaro's own Composer home.
- **Node.js.** The Current line and every maintained LTS line, with the active one behind
  `node`, `npm`, `npx` and `corepack`.
- **Services.** nginx, one php-cgi per PHP version, DNS for `.test`, MariaDB 11.8,
  PostgreSQL 18, Redis 8, phpMyAdmin and Mailpit start and stop from one page. A service
  that crashes is restarted. The first start of each shows a progress bar for the
  download, unpacking and setup.
- **Databases.** Create, drop, export and import MariaDB databases of any size, streamed
  to and from disk. Importing reads a dump first, lists the databases in it and loads only
  the one you choose, so a dump made with `--all-databases` can't write into MariaDB's own
  system database.
- **Mail.** Mailpit catches every email your apps send on `127.0.0.1:1025`, and PHP's
  `mail()` is pointed at it.
- **Logs.** A live viewer for the nginx, PHP, MariaDB, PostgreSQL, Redis, Mailpit and
  worker logs, with search and a level filter.
- **Command line.** Once Zefaro's folder is on PATH, `php`, `composer`, `laravel`, `node`,
  `npm`, `npx`, `mariadb`, `mysql`, `mariadb-dump`, `mysqldump`, `mariadb-admin`, `psql`,
  `pg_dump`, `pg_restore`, `createdb`, `dropdb` and `redis-cli` work in any terminal and
  connect to Zefaro's own servers.
- **System tray.** Closing the window keeps Zefaro and its services running in the system
  tray; quitting from the tray stops everything in order. A second launch shows the
  running window.
- **Languages.** English and Bahasa Indonesia, from Windows' language or a choice in
  Settings, in the interface, messages, documentation and installer.
- **Documentation.** Built in, with search on Ctrl+K.

### Notes

- Zefaro keeps its settings, programs and data in `%USERPROFILE%\.config\zefaro`.
- Every service listens on `127.0.0.1` only.
- The installer isn't code-signed yet, so Windows SmartScreen asks you to confirm it.

[1.0.1]: https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.0.1
[1.0.0]: https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.0.0
