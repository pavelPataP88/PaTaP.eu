$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendScript = Join-Path $root "start-backend.ps1"
$originScript = Join-Path $root "start-origin.ps1"
$tunnelScript = Join-Path $root "start-patap-tunnel.ps1"

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
  return [bool](Test-OriginReachable) -and [bool](Get-Process caddy -ErrorAction SilentlyContinue)
}

function Test-PatapTunnel {
  $process = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*tunnel run*" -and $_.CommandLine -like "*patap-lab-token.txt*" } |
    Select-Object -First 1

  if ($process) {
    return $true
  }

  return [bool](Get-Process cloudflared -ErrorAction SilentlyContinue)
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

if (-not (Test-Path -LiteralPath $backendScript)) {
  throw "Backend script not found: $backendScript"
}

if (-not (Test-Path -LiteralPath $originScript)) {
  throw "Origin script not found: $originScript"
}

if (-not (Test-Path -LiteralPath $tunnelScript)) {
  throw "Tunnel script not found: $tunnelScript"
}

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

[PSCustomObject]@{
  OriginListening = [bool](Get-OriginListener)
  BackendHealth = [bool](Test-BackendHealth)
  BackendRunning = [bool]((Test-BackendProcess) -or (Test-BackendHealth))
  CaddyRunning = [bool](Test-CaddyOrigin)
  TunnelRunning = [bool](Test-PatapTunnel)
}
