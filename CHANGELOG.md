# Changelog

All notable changes to Zefaro are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Zefaro uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Databases page for MySQL and PostgreSQL.** The gear on the MySQL and PostgreSQL cards now opens the
  Databases page too, with a tab for each of MariaDB, MySQL and PostgreSQL: list databases with their size and
  tables, create, drop, and export or import dumps of any size with progress and cancel. PostgreSQL exports
  with `pg_dump` (SQL, without ownership or grants) and imports pg_dump SQL through `psql` or the custom format
  (`pg_dump -Fc`) through `pg_restore`, leaving out `\connect`, `CREATE DATABASE`, `OWNER TO`, `GRANT` and
  `REVOKE`. A dump made by the other kind of server is refused before anything changes. Backups and
  phpMyAdmin stay MariaDB-only.

### Fixed

- MySQL couldn't be installed: Oracle's download link answered Zefaro with 403 Forbidden. Zefaro now downloads
  the same zip from Oracle's CDN, still checked against the pinned SHA-256.
- MySQL's database sizes on the Databases page are read from its data files, so they are current right after
  an import instead of lagging behind InnoDB's statistics.

## [1.3.0] - 2026-10-30

### Added

- **MySQL 9.7 LTS.** A MySQL card on the Services page, next to MariaDB. It listens on `127.0.0.1:3307` with
  user `root` and no password, so MariaDB keeps 3306 and both can run at once. The first start downloads
  Oracle's zip (328 MB, checked against a pinned SHA-256) and unpacks the server and its tools without the
  840 MB of debug symbols. The New site wizard can create a Laravel app on it (`DB_CONNECTION=mysql`,
  `DB_PORT=3307`), the site page offers to start it when the app can't connect, its log is on the Logs page,
  and it can start with Zefaro. The Databases page, backups and phpMyAdmin stay MariaDB-only.
- **Terminal.** A Terminal page under Tools runs PowerShell, Command Prompt or Git Bash inside Zefaro, on a
  Windows pseudo console, so colours, prompts and interactive programs (`php artisan tinker`, `mysql`,
  `npm run dev`) work as in Windows Terminal. Each terminal starts with Zefaro's PHP, Composer, Laravel
  installer, Node.js and database clients first on PATH, without *Add to PATH*; one opened for a site starts in
  its folder with its PHP version. Tabs, find, copy and paste, clickable links and text size are there.
  Terminals keep running when you switch pages or close the window to the tray, and quitting Zefaro or closing
  a tab ends everything started in them. Needs Windows 10 version 1809 or later.

### Changed

- In `zefaro.json`, the database driver `mysql` now means Zefaro's MySQL. Use `mariadb` for MariaDB; Zefaro
  writes `mysql` only for an app whose `.env` uses port 3307.

### Fixed

- The `mysql` and `mariadb` commands can sign in to MySQL 8 and later (`-P 3307` for Zefaro's own). They
  couldn't find MariaDB's `caching_sha2_password` plugin before.

## [1.2.0] - 2026-10-30

### Added

- **Start with Windows.** Settings has a switch that adds Zefaro to the programs Windows starts when you sign
  in. It opens hidden in the system tray. Below it, one switch starts your services whenever Zefaro opens
  (nginx, MariaDB, PostgreSQL, Redis, Mailpit and, with `.test`, DNS). Only services that are already installed
  start, so opening Zefaro never downloads anything, and one that fails to start shows why on its card. The
  entry is one value under the user's `Run` key, so no admin rights are needed, and the uninstaller removes it.
- **Back up and restore.** Settings can save your sites, settings and MariaDB databases into one zip file and
  load such a file again, on this computer or another. A restore shows what is inside first. Databases load into
  new databases and one that already exists is skipped, never overwritten; the previous `config.json` is kept
  next to the restored one. The HTTPS certificate authority is not included: its private key is encrypted for
  the Windows account and can't be opened anywhere else. PostgreSQL databases are not included yet.
- **Update now.** When a new version is out, the notification and Settings offer to download its installer from
  the project's GitHub release, check it against the SHA-256 published with the release (and the one GitHub
  reports for the file), then stop the services, close and run the installer, which opens Zefaro again. A file
  that doesn't match is deleted and never run. Nothing is downloaded until you click.
- **A local domain that needs no admin rights: `.localhost`.** Every other step of Zefaro works without admin
  rights except the one-time Windows DNS rule. With `.localhost` there is no rule and no DNS server: Chrome, Edge
  and Firefox send `*.localhost` names to your own computer. Zefaro offers it when the Windows account can't
  approve admin prompts. Windows 10 itself doesn't resolve these names, so `curl` and sites that call their own
  address can't find them; the DNS settings and Diagnostics say so.
- **Change a site's PHP version.** The PHP column of the Sites page and the site's own page have a picker
  with the installed versions. With nginx running, Zefaro starts the chosen PHP first and only then points
  the site at it, so the site never answers 502; if that PHP can't start, nothing changes. A version that
  isn't installed any more shows a warning sign.

### Changed

- **Settings in three tabs.** General, Updates and backup, and HTTPS and system, each short enough for the
  default window without scrolling, with one short line per setting at most. A tab shows a dot when it holds
  an update or a certificate authority that isn't trusted yet.
- **Switches for everything that is on or off:** running a service or a site's worker, HTTPS for a site,
  following a log, the DNS server, and the backup and restore options. Installing a service the first time is
  still a button, so a switch never starts a download.
- **A new sidebar.** The pages you work in at the top, help and Settings at the bottom, and the open page
  marked by a light indigo fill. When a new version is out, a card above Settings offers it. Cards are flat,
  without a shadow.
- The installer's uninstall step also removes the start-with-Windows entry.
- A failed admin step now says when the account can't approve admin prompts, and points to `.localhost`.

## [1.1.0] - 2026-10-29

### Added

- **Update check.** When Zefaro starts, it asks GitHub for its latest release and says when a
  new version is out, with a link to download it; the sidebar shows the new version too. It
  never downloads or installs anything by itself. Settings has a switch to turn it off and a
  *Check now* button.
- **Diagnostics page** (under Help). Checks the Visual C++ runtime, ports held by other programs
  (naming the program, with a hint when it is XAMPP or Laragon), the `.test` rule and whether
  names resolve, hosts file entries that override site names, the certificate authority, PATH,
  and site folders that have moved. Each finding links to the place that fixes it.
- **Import from XAMPP or Laragon** (Sites page). Lists the projects in XAMPP's `htdocs` or
  Laragon's `www`, or any folder you pick, and links the ones you choose where they are. Copies
  databases out of the old MySQL into compressed dumps and loads them into Zefaro's MariaDB.
- **New site: WordPress, PHP and dev servers.** Besides Laravel apps, the wizard makes a WordPress
  site (latest release from WordPress.org, checked against its SHA-1, with a MariaDB database and
  `wp-config.php`), a plain PHP folder with an `index.php`, or a `.test` address that forwards to
  a project's own dev server (Vite, Next.js), WebSocket included for hot reload.
- **zefaro.json.** A project file with the site's name, PHP version, HTTPS, dev server port,
  services, database and workers. Linking a folder that has one offers to apply it; the site
  page writes one from the site's current settings.
- **Dumps page** (under Tools). With *Catch dumps* on, `dump()` and `dd()` from sites that use
  Symfony's VarDumper (Laravel, Symfony) appear in Zefaro with their file and line, instead of
  in the page.
- **Xdebug.** A PHP version's settings page downloads Xdebug for that version (checked against
  its SHA-256) and adds it to the extension list; switching it on sets up step debugging that
  only starts when the editor or browser asks. A button copies a `launch.json` for VS Code.

### Changed

- **Site page.** A header card with the site's address (with a copy button), path and versions;
  *Open in browser* and an *Open in* menu for editors, terminals and database tools side by
  side; tabs with icons. The Overview starts with what needs attention, then four tiles
  (database, migrations, queue, mail) that open the matching tab, then two detail cards and the
  packages the app uses.
- **Home** no longer has *Start all* or the list of services; both live on the Services page.
  The setup step for services opens that page.
- **PHP versions** are activated with a switch instead of a button.

### Fixed

- **Home opens at once.** It waited for Composer, two network lookups and PowerShell before
  showing anything; now it shows what it has right away and checks PATH afterwards. Published
  versions of Composer and the Laravel installer are looked up at most every few hours, at the
  same time.
- **A site's Overview no longer takes four seconds when its database is stopped.** Windows takes
  that long to report a refused connection; Zefaro now checks the port quickly first. The last
  overview of each site shows at once when you come back to it.

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

[Unreleased]: https://github.com/andikatuluspangestu/zefaro/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.3.0
[1.2.0]: https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.2.0
[1.1.0]: https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.1.0
[1.0.1]: https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.0.1
[1.0.0]: https://github.com/andikatuluspangestu/zefaro/releases/tag/v1.0.0
