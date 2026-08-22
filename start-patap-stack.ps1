$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "patap-processes.ps1")

$backendScript = Join-Path $root "start-backend.ps1"
$originScript = Join-Path $root "start-origin.ps1"
$tunnelScript = Join-Path $root "start-patap-tunnel.ps1"
$healthWatchScript = Join-Path $root "start-patap-health-watch.ps1"
$caddyConfig = Join-Path $root "Caddyfile.tunnel"
$tokenFile = Join-Path $env:LOCALAPPDATA "PatapLab\cloudflared\patap-lab-token.txt"
$healthWatchPidFile = Join-Path $root "var\run\patap-health-watch.pid"
$healthWatchTarget = [IO.Path]::GetFullPath((Join-Path $root "watch-patap-health.ps1"))

function Get-OriginListener {
  Test-OriginReachable
}

function Test-OriginReachable {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8090" -UseBasicParsing -TimeoutSec 3
    return [bool]($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Test-CaddyOrigin {
  return [bool](Test-OriginReachable) -and [bool](Get-PatapCaddyProcess $caddyConfig)
}

function Test-PatapTunnel {
  return [bool](Get-PatapTunnelProcess $tokenFile)
}

function Test-BackendHealth {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8091/api/health" -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-BackendProcess {
  return [bool](Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*server*auth*server.js*" } |
    Select-Object -First 1)
}

function Test-HealthWatchProcess {
  if (-not (Test-Path -LiteralPath $healthWatchPidFile -PathType Leaf)) { return $false }
  $pidText = (Get-Content -LiteralPath $healthWatchPidFile -Raw).Trim()
  $watchPid = 0
  if (-not [int]::TryParse($pidText, [ref]$watchPid)) { return $false }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $watchPid" -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  return [string]$process.CommandLine -match "(?i)$([Regex]::Escape($healthWatchTarget))"
}

foreach ($required in @($backendScript, $originScript, $tunnelScript, $healthWatchScript, $caddyConfig)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required PaTaP file not found: $required" }
}
if (-not (Test-Path -LiteralPath $tokenFile -PathType Leaf)) { throw "Tunnel token file not found: $tokenFile" }

if (-not (Test-BackendHealth)) {
  & $backendScript | Out-Null
  Start-Sleep -Seconds 1
}

if (-not (Test-CaddyOrigin)) {
  & $originScript | Out-Null
  Start-Sleep -Seconds 1
}

if (-not (Test-PatapTunnel)) {
  & $tunnelScript | Out-Null
  Start-Sleep -Seconds 1
}

if (-not (Test-HealthWatchProcess)) {
  & $healthWatchScript | Out-Null
  Start-Sleep -Seconds 1
}

[PSCustomObject]@{
  OriginListening = [bool](Get-OriginListener)
  BackendHealth = [bool](Test-BackendHealth)
  BackendRunning = [bool]((Test-BackendProcess) -or (Test-BackendHealth))
  CaddyRunning = [bool](Test-CaddyOrigin)
  TunnelRunning = [bool](Test-PatapTunnel)
  HealthWatchRunning = [bool](Test-HealthWatchProcess)
}
