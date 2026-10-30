# Scoop bucket for Zefaro

[Zefaro](https://zefaro.pages.dev) is a free, open-source local PHP and Laravel development
environment for Windows, an alternative to XAMPP and Laragon.

```powershell
scoop bucket add zefaro https://github.com/andikatuluspangestu/scoop-zefaro
scoop install zefaro/zefaro
```

Update with `scoop update zefaro`. Zefaro keeps your sites, settings and databases in
`%USERPROFILE%\.config\zefaro`, so `scoop uninstall zefaro` leaves them in place. Uninstalling
removes what Zefaro added to Windows outside that folder: its PATH entry, the
start-with-Windows entry, the `*.test` DNS rule and its certificate authority.

The manifest takes the installer from Zefaro's
[GitHub releases](https://github.com/andikatuluspangestu/zefaro/releases) and checks it against
the SHA-256 published with each release. A scheduled workflow updates it when a new release is out.

Zefaro can also be installed with winget: `winget install Zefaro.Zefaro`.
