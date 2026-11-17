; Do not force-close myLFR while records may still be saving. The standard
; Tauri NSIS macro offers to kill a running process; this pre-flight check
; stops the installer first and asks the receiver to close the app normally.

!macro MYLFR_CHECK_APP_CLOSED
  nsis_tauri_utils::FindProcessCurrentUser "mylfr-desktop.exe"
  Pop $R0
  ${If} $R0 = 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "myLFR Desktop is still open.$\r$\n$\r$\nPlease save your work and close myLFR Desktop, then run the installer again."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro MYLFR_CHECK_APP_CLOSED
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro MYLFR_CHECK_APP_CLOSED
!macroend
