# Packaging

Zefaro is published to two Windows package managers. Both take the installer from the
GitHub release and check it against `SHA256SUMS.txt`, so a release must include that file.

## winget

`winget/manifests/z/Zefaro/Zefaro/<version>/` holds the manifests as submitted to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) under the same path.
The installer is the per-user NSIS setup (`Scope: user`, silent `/S`); `ProductCode: Zefaro`
is the uninstall key the installer writes.

For a new release, after the GitHub release is published:

```powershell
wingetcreate update Zefaro.Zefaro --version 1.2.0 `
  --urls https://github.com/andikatuluspangestu/zefaro/releases/download/v1.2.0/Zefaro_1.2.0_x64-setup.exe `
  --submit
```

Copy the generated manifests into `winget/manifests/` so this folder keeps the latest one,
and check them with `winget validate --manifest <folder>` first.

## Scoop

`scoop-bucket/` is the content of the
[scoop-zefaro](https://github.com/andikatuluspangestu/scoop-zefaro) bucket repository.
`bucket/zefaro.json` unpacks the NSIS installer with 7-Zip instead of running it, so a Scoop
install has no entry in Apps and features. Its uninstaller runs `uninstall-cleanup.ps1` only on
`scoop uninstall`, not on `scoop update`, so updates keep the PATH entry, DNS rule and
certificate authority.

The bucket's Excavator workflow updates the manifest once a day from the latest release; run it
by hand from the Actions tab right after a release.
