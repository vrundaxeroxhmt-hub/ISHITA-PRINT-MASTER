!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Keep Customer Data, WhatsApp Session, License and Master Save Folder?$\r$\n$\r$\nChoose Yes to keep all user data for a future reinstall or update." IDYES keepData
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "Remove SMART PRINT local settings, WhatsApp session and licence?$\r$\n$\r$\nThe external Master Save Folder is protected and must be deleted manually." IDNO keepData
  RMDir /r "$APPDATA\SMART PRINT"
  keepData:
!macroend
