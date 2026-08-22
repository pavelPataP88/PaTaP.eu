param(
  [ValidateRange(10, 3600)][int]$IntervalSeconds = 60,
  [ValidateRange(1, 20)][int]$FailureThreshold = 3
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchScript = [IO.Path]::GetFullPath((Join-Path $root "watch-patap-health.ps1"))
$runDirectory = Join-Path $root "var\run"
$pidFile = Join-Path $runDirectory "patap-health-watch.pid"
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $watchScript -PathType Leaf)) { throw "Health watch script not found: $watchScript" }

function Get-ExpectedProcess([int]$ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  $escaped = [Regex]::Escape($watchScript)
  if ([string]$process.CommandLine -notmatch "(?i)$escaped") { return $null }
  return $process
}

if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
  $pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  $existingPid = 0
  if ([int]::TryParse($pidText, [ref]$existingPid)) {
    $existing = Get-ExpectedProcess $existingPid
    if ($existing) {
      [PSCustomObject]@{ Started = $false; AlreadyRunning = $true; ProcessId = $existingPid }
      exit 0
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

$arguments = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $watchScript,
  "-IntervalSeconds", [string]$IntervalSeconds,
  "-FailureThreshold", [string]$FailureThreshold
)
$process = Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 700

if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
  throw "PaTaP health watch exited immediately"
}
if (-not (Get-ExpectedProcess $process.Id)) {
  throw "Started process does not match the PaTaP health watch command"
}

[PSCustomObject]@{ Started = $true; AlreadyRunning = $false; ProcessId = $process.Id }
