param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
$thumbprint = $env:WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT
$logPath = $env:WINDOWS_SIGNING_LOG_PATH

function Write-SigningLog {
  param([string]$Message)
  if ($logPath) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message"
  }
}

if ($thumbprint -notmatch '^[0-9A-Fa-f]{40}$') {
  throw 'WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT is missing or invalid.'
}

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$signTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
  Sort-Object FullName -Descending |
  Select-Object -First 1 -ExpandProperty FullName

if (!$signTool) {
  throw 'Windows SignTool was not found.'
}

$signed = $false
for ($attempt = 1; $attempt -le 3; $attempt += 1) {
  Write-SigningLog "Signing attempt $attempt for $resolvedPath with $signTool"
  $signingOutput = & $signTool sign /sha1 $thumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $resolvedPath 2>&1
  $signingExitCode = $LASTEXITCODE
  foreach ($line in $signingOutput) {
    Write-Host $line
    Write-SigningLog ([string]$line)
  }
  if ($signingExitCode -eq 0) {
    $signed = $true
    break
  }
  if ($attempt -lt 3) {
    Start-Sleep -Seconds 2
  }
}

if (!$signed) {
  throw "Authenticode signing failed for $resolvedPath."
}

$applicationBinary = if ($env:MYLFR_RELEASE_BINARY) { $env:MYLFR_RELEASE_BINARY } else { 'mylfr-desktop.exe' }
if (
  [IO.Path]::GetFileName($resolvedPath) -ieq $applicationBinary -and
  $env:WINDOWS_SIGNED_EXECUTABLE_PATH
) {
  Copy-Item -LiteralPath $resolvedPath -Destination $env:WINDOWS_SIGNED_EXECUTABLE_PATH -Force
  Write-SigningLog "Preserved signed executable at $env:WINDOWS_SIGNED_EXECUTABLE_PATH"
  Write-Host "Preserved signed application executable: $env:WINDOWS_SIGNED_EXECUTABLE_PATH"
}

Write-SigningLog "SignTool completed successfully for $resolvedPath"
Write-Host "Authenticode signed: $resolvedPath"
