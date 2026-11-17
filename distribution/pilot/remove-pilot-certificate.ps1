$ErrorActionPreference = 'Stop'
$thumbprint = '4A64D92E4FE40341E60A19720CBFFD1E5DA7ADB4'
$removed = 0

foreach ($store in @('Root', 'TrustedPublisher')) {
  $path = "Cert:\CurrentUser\$store\$thumbprint"
  if (Test-Path $path) {
    Remove-Item $path -Force
    $removed += 1
  }
}

Write-Host "Removed $removed trusted copies of the myLFR pilot certificate."
