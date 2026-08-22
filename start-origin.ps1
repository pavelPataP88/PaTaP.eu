$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "patap-processes.ps1")

$logDir = Join-Path $root "var\logs"
$caddyOutLog = Join-Path $logDir "patap-lab-caddy.log"
$caddyErrLog = Join-Path $logDir "patap-lab-caddy.err.log"
$caddyConfig = Join-Path $root "Caddyfile.tunnel"

function Test-OriginReachable {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8090" -UseBasicParsing -TimeoutSec 3
    return [bool]($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch { return $false }
}

if (-not (Test-Path -LiteralPath $caddyConfig -PathType Leaf)) {
  throw "Caddy config not found: $caddyConfig"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
npm.cmd run build

$existing = Get-PatapCaddyProcess $caddyConfig
if (-not $existing) {
  $listener = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    throw "Port 8090 is already occupied by PID $($listener.OwningProcess), but that process is not PaTaP Caddy with $caddyConfig."
  }

  $caddy = Resolve-PatapCaddyExecutable
  $started = Start-Process -FilePath $caddy -ArgumentList @("run", "--config", $caddyConfig, "--adapter", "caddyfile") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $caddyOutLog -RedirectStandardError $caddyErrLog -PassThru
  Start-Sleep -Seconds 2
  $existing = Get-PatapCaddyProcess $caddyConfig
  if (-not $existing -or $existing.ProcessId -ne $started.Id -or -not (Test-OriginReachable)) {
    $detail = if (Test-Path -LiteralPath $caddyErrLog) { (Get-Content -LiteralPath $caddyErrLog -Tail 20 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
    throw "PaTaP Caddy did not become healthy on 127.0.0.1:8090. PID=$($started.Id). $detail"
  }
} elseif (-not (Test-OriginReachable)) {
  throw "PaTaP Caddy process exists but origin 127.0.0.1:8090 is not healthy."
}

[PSCustomObject]@{
  OriginListening = [bool](Test-OriginReachable)
  CaddyProcessId = [int]$existing.ProcessId
}
