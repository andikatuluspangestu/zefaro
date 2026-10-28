<#
  Zefaro uninstall cleanup, run by the uninstaller (installer/hooks.nsh).

  Removes what Zefaro added to Windows outside its install folder:
    1. %USERPROFILE%\.config\zefaro\bin from the user PATH (from "Add to PATH")
    2. the DNS rule that sends *.test lookups to Zefaro (asks for admin only if it exists)
    3. Zefaro's certificate authority from the user's trusted root certificates,
       if it was trusted (Windows asks to confirm)
  Sites, settings and databases in %USERPROFILE%\.config\zefaro are kept.

  -PathValueName and -DryRun exist so this can be tested without touching a
  real setup.
#>
param(
  [string]$PathValueName = 'Path',
  [switch]$DryRun
)

# 1. PATH: keep the value's REG_EXPAND_SZ type and every other entry as written.
$bin = (Join-Path $env:USERPROFILE '.config\zefaro\bin').TrimEnd('\')
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($key) {
  $raw = $key.GetValue($PathValueName, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $keep = @($raw -split ';' | Where-Object { $_ -and ([Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ine $bin) })
  $new = $keep -join ';'
  if ($new -ne $raw) {
    $key.SetValue($PathValueName, $new, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    # Tell running programs (Explorer, new terminals) that the environment changed.
    [Environment]::SetEnvironmentVariable('ZEFARO_ENV_REFRESH', '1', 'User')
    [Environment]::SetEnvironmentVariable('ZEFARO_ENV_REFRESH', $null, 'User')
    Write-Output "Removed $bin from $PathValueName."
  }
  $key.Close()
}

# 2. DNS rule. The comment must match RULE_COMMENT in src-tauri/src/engine/dns.rs.
$comment = 'Zefaro: local development sites'
if (Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object { $_.Comment -eq $comment }) {
  if ($DryRun) {
    Write-Output 'Would remove the *.test DNS rule (asks for admin).'
  } else {
    $remove = "Get-DnsClientNrptRule | Where-Object { `$_.Comment -eq '$comment' } | Remove-DnsClientNrptRule -Force; Clear-DnsClientCache"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remove))
    try {
      Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden `
        -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded
      Write-Output 'Removed the *.test DNS rule.'
    } catch {
      Write-Output 'Kept the *.test DNS rule because the admin prompt was declined.'
    }
  }
}

# 3. Zefaro's local certificate authority. The name must match CA_NAME and
#    ORGANIZATION in src-tauri/src/engine/certs.rs.
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
$store.Open('ReadOnly')
$cas = @($store.Certificates | Where-Object {
  $_.GetNameInfo('SimpleName', $false) -like 'Zefaro Local CA (*)' -and $_.Subject -like '*O=Zefaro local development*'
})
$store.Close()
foreach ($ca in $cas) {
  if ($DryRun) {
    Write-Output "Would remove the trusted certificate $($ca.Subject) ($($ca.Thumbprint))."
    continue
  }
  try {
    # Windows shows its own confirmation dialog for removing a root certificate.
    $store.Open('ReadWrite')
    $store.Remove($ca)
    Write-Output "Removed the trusted certificate $($ca.Subject)."
  } catch {
    Write-Output "Kept the trusted certificate $($ca.Subject) because the removal was declined."
  } finally {
    $store.Close()
  }
}
