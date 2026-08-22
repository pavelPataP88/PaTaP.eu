$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendScript = Join-Path $root "server\auth\server.js"
$runtimeCheckScript = Join-Path $root "scripts\check-node-runtime.js"
$logsDirectory = Join-Path $root "var\logs"
$runDirectory = Join-Path $root "var\run"
$supervisorPidFile = Join-Path $runDirectory "patap-auth-supervisor.pid"
$backendPidFile = Join-Path $runDirectory "patap-auth-backend.pid"
$maintenanceFlag = Join-Path $runDirectory "patap-auth-maintenance.flag"
$supervisorLog = Join-Path $logsDirectory "patap-auth-supervisor.log"
$stdoutLog = Join-Path $logsDirectory "patap-auth-backend.log"
$stderrLog = Join-Path $logsDirectory "patap-auth-backend.err.log"
$maximumArchivedLogs = 20
$quickExitThresholdSeconds = 15
$quickExitWindowSeconds = 60
$maximumQuickExits = 3

New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
Set-Content -LiteralPath $supervisorPidFile -Value $PID -Encoding ascii

function Write-SupervisorLog([string]$message) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff zzz"
  Add-Content -LiteralPath $supervisorLog -Value "[$timestamp] $message" -Encoding utf8
}

function Test-MaintenanceMode {
  return Test-Path -LiteralPath $maintenanceFlag
}

function Archive-Log([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $file = Get-Item -LiteralPath $path
  if ($file.Length -eq 0) { return }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $archiveName = "$($file.BaseName)-$timestamp$($file.Extension)"
  Move-Item -LiteralPath $file.FullName -Destination (Join-Path $logsDirectory $archiveName)

  Get-ChildItem -LiteralPath $logsDirectory -File |
    Where-Object { $_.Name -like "$($file.BaseName)-*$($file.Extension)" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $maximumArchivedLogs |
    Remove-Item -Force
}

function Test-SupportedNodeRuntime {
  if (-not (Test-Path -LiteralPath $runtimeCheckScript)) {
    Write-SupervisorLog "Node runtime check script not found: $runtimeCheckScript"
    return $false
  }
  try {
    $output = @(& node.exe $runtimeCheckScript 2>&1)
    $exitCode = $LASTEXITCODE
    foreach ($line in $output) {
      if (-not [string]::IsNullOrWhiteSpace([string]$line)) {
        Write-SupervisorLog "Runtime check: $line"
      }
    }
    if ($exitCode -ne 0) {
      Write-SupervisorLog "Unsupported Node.js runtime. Supervisor will not start a restart loop."
      return $false
    }
    return $true
  } catch {
    Write-SupervisorLog "Node runtime check failed: $($_.Exception.Message)"
    return $false
  }
}

if (-not (Test-SupportedNodeRuntime)) {
  Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
  exit 1
}

if (-not (Test-Path -LiteralPath $backendScript)) {
  Write-SupervisorLog "Backend script not found: $backendScript"
  Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
  exit 1
}

if (Test-MaintenanceMode) {
  Write-SupervisorLog "Maintenance flag is active. Supervisor will not start the backend."
  Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
  exit 0
}

$quickExitTimes = [Collections.Generic.List[DateTime]]::new()
Write-SupervisorLog "Supervisor started (PID $PID). Crash-loop guard: max $maximumQuickExits exits under ${quickExitThresholdSeconds}s within ${quickExitWindowSeconds}s."

try {
  while ($true) {
    if (Test-MaintenanceMode) {
      Write-SupervisorLog "Maintenance flag detected. Supervisor is exiting without restarting the backend."
      break
    }

    try {
      $existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*server*auth*server.js*" } |
        Select-Object -First 1

      if ($existing) {
        Set-Content -LiteralPath $backendPidFile -Value $existing.ProcessId -Encoding ascii
        Write-SupervisorLog "Using existing backend process PID $($existing.ProcessId)."
        while (Get-Process -Id $existing.ProcessId -ErrorAction SilentlyContinue) {
          Start-Sleep -Seconds 2
        }
        Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
        Write-SupervisorLog "Existing backend process PID $($existing.ProcessId) stopped."
        if (Test-MaintenanceMode) { continue }
        Start-Sleep -Seconds 2
        continue
      }

      if (Test-MaintenanceMode) { continue }

      Archive-Log $stdoutLog
      Archive-Log $stderrLog

      $startedAt = Get-Date
      $backend = Start-Process -FilePath "node.exe" `
        -ArgumentList @($backendScript) `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru

      Write-SupervisorLog "Backend started (PID $($backend.Id))."
      Set-Content -LiteralPath $backendPidFile -Value $backend.Id -Encoding ascii
      $backend.WaitForExit()
      $stoppedAt = Get-Date
      Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue

      try {
        $backend.Refresh()
        $exitCode = if ($null -eq $backend.ExitCode) { "unknown" } else { $backend.ExitCode }
      } catch {
        $exitCode = "unknown"
      }

      $uptimeSeconds = [Math]::Max(0, ($stoppedAt - $startedAt).TotalSeconds)
      Write-SupervisorLog "Backend stopped (PID $($backend.Id), exit code $exitCode, uptime $([Math]::Round($uptimeSeconds, 2))s)."

      if (Test-MaintenanceMode) {
        Write-SupervisorLog "Maintenance flag is active after backend exit. Restart suppressed."
        continue
      }

      if ($uptimeSeconds -lt $quickExitThresholdSeconds) {
        $quickExitTimes.Add($stoppedAt)
        $windowStart = $stoppedAt.AddSeconds(-$quickExitWindowSeconds)
        for ($index = $quickExitTimes.Count - 1; $index -ge 0; $index--) {
          if ($quickExitTimes[$index] -lt $windowStart) { $quickExitTimes.RemoveAt($index) }
        }
        Write-SupervisorLog "Quick backend exit recorded ($($quickExitTimes.Count)/$maximumQuickExits in ${quickExitWindowSeconds}s window)."
        if ($quickExitTimes.Count -ge $maximumQuickExits) {
          Write-SupervisorLog "Crash-loop circuit breaker OPEN. Automatic restart stopped; manual inspection is required."
          break
        }
      } else {
        $quickExitTimes.Clear()
      }
    } catch {
      Write-SupervisorLog "Supervisor error: $($_.Exception.Message)"
    }

    if (-not (Test-MaintenanceMode)) { Start-Sleep -Seconds 3 }
  }
} finally {
  Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
  Write-SupervisorLog "Supervisor exited (PID $PID)."
}
