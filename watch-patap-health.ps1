param(
  [ValidateRange(10, 3600)][int]$IntervalSeconds = 60,
  [ValidateRange(1, 20)][int]$FailureThreshold = 3,
  [ValidateRange(0, 1000000)][int]$Iterations = 0
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$watchScriptPath = [IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
$root = Split-Path -Parent $watchScriptPath
$statusScript = Join-Path $root "status-patap-stack.ps1"
$runDirectory = Join-Path $root "var\run"
$logsDirectory = Join-Path $root "var\logs"
$pidFile = Join-Path $runDirectory "patap-health-watch.pid"
$latestFile = Join-Path $runDirectory "patap-health-watch.json"
$maintenanceFlag = Join-Path $runDirectory "patap-auth-maintenance.flag"
$logFile = Join-Path $logsDirectory "patap-health-watch.log"
$maxLogBytes = 1MB
$maxArchivedLogs = 5

New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $statusScript -PathType Leaf)) {
  throw "PaTaP status script not found: $statusScript"
}

function Write-WatchLog([string]$Message) {
  if (Test-Path -LiteralPath $logFile -PathType Leaf) {
    $item = Get-Item -LiteralPath $logFile
    if ($item.Length -ge $maxLogBytes) {
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
      $archive = Join-Path $logsDirectory "patap-health-watch-$stamp.log"
      Move-Item -LiteralPath $logFile -Destination $archive
      Get-ChildItem -LiteralPath $logsDirectory -Filter "patap-health-watch-*.log" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $maxArchivedLogs |
        Remove-Item -Force
    }
  }
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff zzz"
  Add-Content -LiteralPath $logFile -Value "[$timestamp] $Message" -Encoding utf8
}

function Write-AtomicJson([object]$Value) {
  $temporary = "$latestFile.tmp.$PID"
  $json = $Value | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath $temporary -Value $json -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $latestFile -Force
}

function Test-ExistingWatchProcess([int]$ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  $command = [string]$process.CommandLine
  $escaped = [Regex]::Escape($watchScriptPath)
  return $command -match "(?i)$escaped"
}

if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
  $existingText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  $existingPid = 0
  if ([int]::TryParse($existingText, [ref]$existingPid) -and $existingPid -ne $PID -and (Test-ExistingWatchProcess $existingPid)) {
    throw "PaTaP health watch is already running as PID $existingPid"
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii
$previousEffective = $null
$consecutiveUnhealthy = 0
$iteration = 0
Write-WatchLog "Health watch started (PID $PID, interval ${IntervalSeconds}s, alert threshold $FailureThreshold)."

try {
  while ($true) {
    $iteration += 1
    $checkedAt = [DateTime]::UtcNow.ToString("o")

    if (Test-Path -LiteralPath $maintenanceFlag -PathType Leaf) {
      $consecutiveUnhealthy = 0
      $state = [PSCustomObject]@{
        overall = "MAINTENANCE"
        effective = "MAINTENANCE"
        checkedAt = $checkedAt
        consecutiveUnhealthy = 0
        failureThreshold = $FailureThreshold
        watcherPid = $PID
        source = "maintenance-flag"
        checks = @()
      }
    } else {
      $raw = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $statusScript 2>&1)
      $probeExit = $LASTEXITCODE
      $payload = $null
      try {
        $payload = (($raw | ForEach-Object { [string]$_ }) -join "`n") | ConvertFrom-Json
      } catch {
        $payload = [PSCustomObject]@{
          overall = "DOWN"
          checkedAt = $checkedAt
          checks = @([PSCustomObject]@{
            component = "health-watch-probe"
            status = "FAIL"
            actual = (($raw | ForEach-Object { [string]$_ }) -join " | ")
            reason = "status-patap-stack.ps1 did not return valid JSON"
          })
        }
        $probeExit = 2
      }

      if ($probeExit -eq 0 -and $payload.overall -eq "HEALTHY") {
        $consecutiveUnhealthy = 0
      } else {
        $consecutiveUnhealthy += 1
      }

      $effective = if ($consecutiveUnhealthy -ge $FailureThreshold) { "ALERT" } else { [string]$payload.overall }
      $state = [PSCustomObject]@{
        overall = [string]$payload.overall
        effective = $effective
        checkedAt = [string]$payload.checkedAt
        consecutiveUnhealthy = $consecutiveUnhealthy
        failureThreshold = $FailureThreshold
        watcherPid = $PID
        source = "status-patap-stack.ps1"
        checks = @($payload.checks)
      }
    }

    Write-AtomicJson $state

    if ($previousEffective -ne $state.effective) {
      Write-WatchLog "State transition: $previousEffective -> $($state.effective); underlying=$($state.overall); consecutiveUnhealthy=$($state.consecutiveUnhealthy)."
      $previousEffective = $state.effective
    }

    if ($Iterations -gt 0 -and $iteration -ge $Iterations) { break }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
    $owned = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($owned -eq [string]$PID) {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
  Write-WatchLog "Health watch exited (PID $PID)."
}
