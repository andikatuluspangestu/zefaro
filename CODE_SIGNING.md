# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

Zefaro's Windows installer (`Zefaro_<version>_x64-setup.exe`) is built from this repository's
public source by the [Release workflow](.github/workflows/release.yml) on GitHub-hosted runners,
and signed there through SignPath. Nothing built on a developer's own computer is signed. The
signature names SignPath Foundation as the publisher. `SHA256SUMS.txt`, published with each
release, lists the SHA-256 of the signed installer; Zefaro's *Update now* checks it before it runs
an update.

Only Zefaro's own installer is signed. Zefaro downloads PHP, nginx, MariaDB, PostgreSQL, Redis,
Mailpit, phpMyAdmin, Node.js, Composer and the other tools from their publishers when you ask it
to; those files are not signed under this policy.

## Team roles

| Role | Members |
| --- | --- |
| Committers and reviewers | [Andika Tulus Pangestu](https://github.com/andikatuluspangestu) |
| Approvers | [Andika Tulus Pangestu](https://github.com/andikatuluspangestu) |

Every change reaches `main` through this repository, where it can be reviewed. A release is
signed only after an approver approves its signing request in SignPath. Team members use
multi-factor authentication for GitHub and SignPath.

## Privacy policy

Zefaro has no accounts, no analytics and no telemetry. It sends no information about you, your
computer or your projects to the Zefaro project or anyone else.

It connects to other computers only to fetch software and version information:

- **When it starts**, if *Check on startup* is on (Settings, Updates and backup), it asks
  `api.github.com` for Zefaro's latest release. You can turn this off.
- **At most once every 30 days**, with PHP installed, it downloads Mozilla's list of trusted
  certificate authorities from `curl.se`, so PHP can verify HTTPS.
- **At most once every 6 hours**, on the PHP page, it reads the latest Composer and Laravel
  installer versions from `getcomposer.org` and `repo.packagist.org`.
- **At most once every 30 minutes**, on the PHP page, it reads the list of PHP releases from
  `downloads.php.net`.
- **When you click** to install, download or update something, it downloads it from its
  publisher: PHP, Xdebug, nginx, MariaDB, PostgreSQL, Redis, Mailpit, phpMyAdmin, Node.js,
  Composer, WordPress, or a new Zefaro installer from this project's GitHub releases.

These requests carry nothing but what any download does (your IP address and a user agent).
Every service Zefaro runs listens on `127.0.0.1` only.
