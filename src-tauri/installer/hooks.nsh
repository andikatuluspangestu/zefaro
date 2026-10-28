; Zefaro — NSIS installer hooks, included by Tauri's installer template.
;
; On uninstall, run uninstall-cleanup.ps1 (installed next to Zefaro.exe) to
; remove what Zefaro added to Windows outside its folder: the PATH entry, the
; *.test DNS rule and the trusted HTTPS certificate authority. Skipped when uninstalling as part of an update
; ($UpdateMode = 1), so updates keep both. Kept as a file rather than an inline
; command so NSIS's string length limit can't truncate it.

!include LogicLib.nsh

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ; Close Zefaro first — the same prompt the uninstaller shows right after this
    ; hook. If the user cancels there, PATH, DNS and HTTPS must still be intact.
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    ; $LANGUAGE is the installer's language; 1057 is Indonesian.
    ${If} $LANGUAGE == 1057
      DetailPrint "Menghapus entri PATH, aturan DNS *.test, dan otoritas sertifikat HTTPS milik Zefaro..."
    ${Else}
      DetailPrint "Removing Zefaro's PATH entry, *.test DNS rule and HTTPS certificate authority..."
    ${EndIf}
    Push $0
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\uninstall-cleanup.ps1"'
    Pop $0
    Pop $0
  ${EndIf}
!macroend
