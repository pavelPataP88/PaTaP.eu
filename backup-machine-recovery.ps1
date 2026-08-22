$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$maintenanceFlag = Join-Path $root "var\run\patap-auth-maintenance.flag"
$enteredMaintenance = $false
$exportSucceeded = $false

if (-not $env:PATAP_MACHINE_DR_EXPORT_DIR -and -not $env:PATAP_DR_EXPORT_DIR) {
  throw "Set PATAP_MACHINE_DR_EXPORT_DIR to an off-host drive or network share."
}
if (-not $env:PATAP_DR_KEY_FILE -and -not $env:PATAP_DR_PASSPHRASE) {
  throw "Set PATAP_DR_KEY_FILE or PATAP_DR_PASSPHRASE. Keep this recovery key separate from the backup drive."
}

Push-Location $root
try {
  & node .\scripts\check-node-runtime.js
  if ($LASTEXITCODE -ne 0) { throw "Node runtime policy check failed." }

  if (-not (Test-Path -LiteralPath $maintenanceFlag)) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "enter-backend-maintenance.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Could not enter PaTaP backend maintenance mode." }
    $enteredMaintenance = $true
  }

  & node .\scripts\export-machine-recovery.js
  if ($LASTEXITCODE -ne 0) { throw "Whole-machine recovery export failed." }
  $exportSucceeded = $true
} finally {
  if ($enteredMaintenance) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "resume-backend.ps1")
    if ($LASTEXITCODE -ne 0) {
      throw "Recovery export finished, but backend resume failed and maintenance was re-enabled."
    }
  }
  Pop-Location
}

if (-not $exportSucceeded) { exit 1 }
