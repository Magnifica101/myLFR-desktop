myLFR Desktop self-signed pilot
================================

This build is for testing only. Its certificate is not trusted by Windows until
you explicitly add the included public certificate to your Windows user account.

Certificate subject:
  CN=myLFR Desktop Pilot Testing

SHA-1 thumbprint:
  4A64D92E4FE40341E60A19720CBFFD1E5DA7ADB4

Before installing
-----------------

1. Keep this folder and the downloaded installer together.
2. Open PowerShell in this folder.
3. Run the following command, replacing `<installer-name>` with the actual
   `.exe` filename in this folder:

   powershell -ExecutionPolicy Bypass -File .\install-pilot-certificate.ps1 -InstallerPath ".\<installer-name>"

4. Read the fingerprint shown by PowerShell and confirm it matches the value above.
5. Accept the Windows security confirmation that adds this testing certificate.
6. Run the installer normally.

After pilot testing
-------------------

Remove the temporary trust entry with:

   powershell -ExecutionPolicy Bypass -File .\remove-pilot-certificate.ps1

The removal script does not uninstall myLFR Desktop or delete its local database.
The certificate contains no private key; the signing key is never included in the
pilot download.

For installing, updating, and backing up production releases, see
`docs/installing-windows.md` in the source repository.
