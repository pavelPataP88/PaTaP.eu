$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $root "var\logs"
$caddyOutLog = Join-Path $logDir "patap-lab-caddy.log"
$caddyErrLog = Join-Path $logDir "patap-lab-caddy.err.log"
$caddyConfig = Join-Path $root "Caddyfile.tunnel"

function Resolve-Caddy {
  $fromPath = Get-Command caddy.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $known = "C:\Users\Biuro\AppData\Local\Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe"
  if (Test-Path -LiteralPath $known) {
    return $known
  }

  throw "caddy.exe not found. Install Caddy or add it to PATH."
}

if (-not (Test-Path -LiteralPath $caddyConfig)) {
  throw "Caddy config not found: $caddyConfig"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

npm.cmd run build

$origin = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue
if (-not $origin) {
  $caddy = Resolve-Caddy
  Start-Process -FilePath $caddy -ArgumentList @("run", "--config", $caddyConfig, "--adapter", "caddyfile") -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

[PSCustomObject]@{
  OriginListening = [bool]((Invoke-WebRequest -Uri "http://127.0.0.1:8090" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue).StatusCode -eq 200)
}
