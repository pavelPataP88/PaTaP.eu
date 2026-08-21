$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendScript = Join-Path $root "server\auth\server.js"
$logsDirectory = Join-Path $root "var\logs"
$runDirectory = Join-Path $root "var\run"
$supervisorPidFile = Join-Path $runDirectory "patap-auth-supervisor.pid"
$backendPidFile = Join-Path $runDirectory "patap-auth-backend.pid"
$supervisorLog = Join-Path $logsDirectory "patap-auth-supervisor.log"
$stdoutLog = Join-Path $logsDirectory "patap-auth-backend.log"
$stderrLog = Join-Path $logsDirectory "patap-auth-backend.err.log"
$maximumArchivedLogs = 20
$supportedNodeMajor = 24

New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
Set-Content -LiteralPath $supervisorPidFile -Value $PID -Encoding ascii

function Write-SupervisorLog([string]$message) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff zzz"
  Add-Content -LiteralPath $supervisorLog -Value "[$timestamp] $message" -Encoding utf8
}

function Archive-Log([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    return
  }

  $file = Get-Item -LiteralPath $path
  if ($file.Length -eq 0) {
    return
  }

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
  try {
    $rawVersion = (& node.exe -p "process.versions.node" 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($rawVersion)) {
      Write-SupervisorLog "Node runtime check failed: node.exe returned no version."
      return $false
    }
    $version = $rawVersion.Trim()
    if ($version -notmatch '^(\d+)\.') {
      Write-SupervisorLog "Node runtime check failed: cannot parse version '$version'."
      return $false
    }
    $major = [int]$Matches[1]
    if ($major -ne $supportedNodeMajor) {
      Write-SupervisorLog "Unsupported Node.js runtime $version. PaTaP requires Node.js $supportedNodeMajor.x LTS. Supervisor will not start a restart loop."
      return $false
    }
    Write-SupervisorLog "Node runtime check passed: $version."
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

Write-SupervisorLog "Supervisor started (PID $PID)."

while ($true) {
  try {
    $existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like "*server*auth*server.js*" } |
      Select-Object -First 1

    if ($existing) {
      Set-Content -LiteralPath $backendPidFile -Value $existing.ProcessId -Encoding ascii
      Write-SupervisorLog "Using existing backend process PID $($existing.ProcessId)."
      while (Get-Process -Id $existing.ProcessId -ErrorAction SilentlyContinue) {
        Start-Sleep -Seconds 5
      }
      Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
      Write-SupervisorLog "Existing backend process PID $($existing.ProcessId) stopped."
      Start-Sleep -Seconds 2
      continue
    }

    Archive-Log $stdoutLog
    Archive-Log $stderrLog

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
    Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
    try {
      $backend.Refresh()
      $exitCode = if ($null -eq $backend.ExitCode) { "unknown" } else { $backend.ExitCode }
    } catch {
      $exitCode = "unknown"
    }
    Write-SupervisorLog "Backend stopped (PID $($backend.Id), exit code $exitCode). Restarting."
  } catch {
    Write-SupervisorLog "Supervisor error: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 3
}
