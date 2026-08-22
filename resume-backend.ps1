$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runDirectory = Join-Path $root "var\run"
$maintenanceFlag = Join-Path $runDirectory "patap-auth-maintenance.flag"
$startScript = Join-Path $root "start-backend.ps1"

if (-not (Test-Path -LiteralPath $startScript)) {
  throw "Backend start script not found: $startScript"
}

if (-not (Test-Path -LiteralPath $maintenanceFlag)) {
  Write-Error "Maintenance flag is not active. Refusing an ambiguous resume operation; use start-backend.ps1 for a normal start."
  exit 2
}

Remove-Item -LiteralPath $maintenanceFlag -Force
try {
  $result = & $startScript
  $exitCode = $LASTEXITCODE
  $result
  if ($exitCode -ne 0) {
    throw "Backend start failed with exit code $exitCode"
  }
} catch {
  Set-Content -LiteralPath $maintenanceFlag -Value ([PSCustomObject]@{
    enteredAt = [DateTime]::UtcNow.ToString("o")
    requestedByPid = $PID
    purpose = "automatic-relock-after-failed-resume"
  } | ConvertTo-Json -Compress) -Encoding utf8
  Write-Error "Backend resume failed; maintenance mode was re-enabled. $($_.Exception.Message)"
  exit 1
}
