# Installing myLFR Desktop on Windows

myLFR Desktop is a Windows application for one Licenced Fish Receiver business
per installation. The application's operational records are stored locally on
the Windows computer. They are not uploaded to myLFR, Supabase, or another
online database.

## Before installing

- Use a supported 64-bit Windows computer: Windows 10 version 22H2 or Windows
  11.
- Download the installer only from the official myLFR website or the official
  myLFR GitHub release linked from that website.
- Keep the downloaded installer until the installation has completed and the
  application has been opened successfully.
- If this computer already contains myLFR records, create and check a
  `.mylfr-backup` file before replacing or uninstalling the application.

myLFR Desktop uses Microsoft's WebView2 runtime to display its screens. Most
supported Windows computers already have WebView2. If it is missing, the
installer may need an internet connection to install it. Do not treat a normal
browser page or `http://localhost:1420` as the desktop application.

## Installation

myLFR Desktop is free and is not signed with a commercial code-signing
certificate, so Windows does not know who published it. Pilot builds have
different instructions below.

1. Download the installer (the file ending in `-setup.exe`) only from the
   [GitHub Releases page](https://github.com/Magnifica101/myLFR-desktop/releases).
   Do not run an installer received by email or from another website.
2. Optional, for extra assurance: compare the installer's SHA-256 checksum with
   the one in `SHA256SUMS.txt` on the same release. In PowerShell, run
   `Get-FileHash .\<installer-name>` and check the two values match exactly.
3. Double-click the installer. Windows SmartScreen shows **Windows protected
   your PC** with **Publisher: Unknown publisher**. This is expected for
   myLFR. Choose **More info**, check the app name is the installer you
   downloaded, then choose **Run anyway**.
4. Follow the prompts. This is a current-user
   installation, so it normally installs for the signed-in Windows user rather
   than all users of the computer.
5. Start **myLFR Desktop** from the Start menu.
6. On first run, read the **Before you start** notice and choose **I
   understand**. Then either create a new installation or choose **Restore from
   backup**. To move an existing business to this computer, use the restore
   option; do not copy or edit the SQLite database manually.
7. Check the business name, client number, and address before entering live
   records.
8. Create a fresh backup and store it somewhere separate from the computer.

Some Windows 11 computers have **Smart App Control** turned on, which can block
unknown unsigned apps without offering **Run anyway**. On a work computer, an
administrator may also block unsigned software. In either case, ask whoever
looks after the computer before changing any security setting. If any other
security warning names a different file or program, stop the installation.

## Updating an existing installation

Save or finish any work before updating. myLFR Desktop finds updates in one of
two ways, chosen in **Settings → Application updates**:

- **Manual** (the setting on a new installation). myLFR contacts the internet
  only when you ask it to. Once a month, on the first Monday after the 15th,
  a round blue download button appears at the bottom of the menu to remind you
  to check. Select it to go straight to **Settings → Application updates**,
  then choose **Check for updates now**. The button stays until a check gets
  through.
- **Automatic**. myLFR checks once a day by itself. When an update is
  available, the same blue button appears; select it to review and install
  the update.

Either way, nothing is installed until you choose **Review and install**,
which shows what's new in the version. Leave **Back up my records before
installing** ticked: the new version updates your records the first time it
opens, and an older version cannot read them afterwards. The application
checks the update's digital signature against myLFR's own key before installing
it, and refuses any update that fails the check.

If myLFR says it couldn't get update information, check your internet
connection and try again later. A check that didn't get through doesn't count,
so the reminder stays.

Do not replace `mylfr-desktop.exe` by hand or install an installer from an
unofficial download. Keep a recent, verified backup before accepting an update,
especially when the release notes mention a database or catalogue change.

## Uninstalling or moving to another computer

1. Create and check a current `.mylfr-backup` file.
2. Close myLFR Desktop.
3. Use **Windows Settings > Apps > Installed apps** to uninstall it, if
   required.
4. On the replacement computer, install the current version and use
   **Restore from backup** during first-run setup.

The live database is normally under:

```text
%LOCALAPPDATA%\nz.co.mylfr.desktop\mylfr.sqlite3
```

Do not delete this data folder as a cleanup step unless the records have been
backed up and the deletion is intentional. An uninstallation is not a backup.

## Pilot and self-signed builds

Pilot builds are for invited testing only. They are not production releases
and their certificate is not trusted by Windows by default.

1. Keep the pilot README, certificate, trust scripts, and installer together.
2. Open PowerShell in that folder.
3. Run the trust script, replacing `<installer-name>` with the actual installer
   filename:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-pilot-certificate.ps1 -InstallerPath ".\<installer-name>"
   ```

4. Confirm that the script displays this fingerprint before accepting the
   certificate trust prompt:

   ```text
   4A64D92E4FE40341E60A19720CBFFD1E5DA7ADB4
   ```

5. Run the installer, complete the test, and report any problem with the
   version and steps that produced it.
6. Remove the temporary certificate trust when testing is complete:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\remove-pilot-certificate.ps1
   ```

Removing the pilot certificate does not uninstall myLFR Desktop or delete its
local database. The certificate contains no private signing key.

## Getting help

When reporting an installation problem, include the Windows version, myLFR
version, exact installer filename, the complete warning text, and whether the
problem occurred before or after the first launch. Report problems on GitHub:
in myLFR, open **Settings → Bug report**, choose **Copy problem report**, then
**Report on GitHub**, and paste the report into the form. If myLFR will not
open, use the
[issue tracker](https://github.com/Magnifica101/myLFR-desktop/issues/new/choose)
directly. Reports are public, so never include business names, permit holders,
vessels, landing details, or a database or backup file.
