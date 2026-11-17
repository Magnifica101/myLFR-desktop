param(
  [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
$expectedThumbprint = '4A64D92E4FE40341E60A19720CBFFD1E5DA7ADB4'
$certificatePath = Join-Path $PSScriptRoot 'myLFR-Desktop-Pilot.cer'
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)

if ($certificate.Thumbprint -ne $expectedThumbprint) {
  throw 'The pilot certificate fingerprint does not match the expected myLFR testing certificate.'
}

Write-Host "Verified myLFR Desktop Pilot Testing certificate: $expectedThumbprint"
Write-Warning 'Windows will ask you to confirm trust for this self-signed testing certificate.'
Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null

Write-Host 'The pilot certificate is now trusted for this Windows user.'
Write-Warning 'This certificate is for testing only. Remove it when pilot testing is complete.'

if ($InstallerPath) {
  $resolvedInstaller = (Resolve-Path $InstallerPath).Path
  $signature = Get-AuthenticodeSignature $resolvedInstaller
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $expectedThumbprint) {
    throw 'The selected installer does not have the expected valid pilot signature.'
  }
  Write-Host "Verified installer signature: $resolvedInstaller"
}
