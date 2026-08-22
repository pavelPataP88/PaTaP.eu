$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchScript = [IO.Path]::GetFullPath((Join-Path $root "watch-patap-health.ps1"))
$pidFile = Join-Path $root "var\run\patap-health-watch.pid"

if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
  [PSCustomObject]@{ Stopped = $false; Reason = "not-running" }
  exit 0
}

$pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
$watchPid = 0
if (-not [int]::TryParse($pidText, [ref]$watchPid)) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  throw "Invalid PaTaP health watch PID file"
}

$process = Get-CimInstance Win32_Process -Filter "ProcessId = $watchPid" -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  [PSCustomObject]@{ Stopped = $false; Reason = "stale-pid"; ProcessId = $watchPid }
  exit 0
}

$escaped = [Regex]::Escape($watchScript)
if ([string]$process.CommandLine -notmatch "(?i)$escaped") {
  throw "PID $watchPid is not the PaTaP health watch process; refusing to stop it"
}

Stop-Process -Id $watchPid -Force
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
[PSCustomObject]@{ Stopped = $true; ProcessId = $watchPid }
