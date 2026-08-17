$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$supervisorScript = Join-Path $root "backend-supervisor.ps1"
$supervisorPidFile = Join-Path $root "var\run\patap-auth-supervisor.pid"

if (-not (Test-Path -LiteralPath $supervisorScript)) {
  throw "Backend supervisor script not found: $supervisorScript"
}

$existing = $null
if (Test-Path -LiteralPath $supervisorPidFile) {
  $supervisorPid = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
  $candidate = Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue
  if ($candidate -and $candidate.ProcessName -eq "powershell") {
    $existing = $candidate
  }
}

if (-not $existing) {
  $logsDirectory = Join-Path $root "var\logs"
  New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
  $pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $supervisorScript) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logsDirectory "patap-auth-supervisor.out.log") `
    -RedirectStandardError (Join-Path $logsDirectory "patap-auth-supervisor.err.log")
}

$health = $false
for ($attempt = 0; $attempt -lt 20 -and -not $health; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8091/api/health" -UseBasicParsing -TimeoutSec 2
    $health = $response.StatusCode -eq 200
  } catch {
    $health = $false
  }
}

[PSCustomObject]@{
  SupervisorRunning = [bool](if (Test-Path -LiteralPath $supervisorPidFile) {
    $supervisorPid = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
    Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue
  })
  BackendHealth = $health
}
