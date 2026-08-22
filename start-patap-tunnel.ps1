$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "patap-processes.ps1")

$tokenFile = Join-Path $env:LOCALAPPDATA "PatapLab\cloudflared\patap-lab-token.txt"
$logDir = Join-Path $root "var\logs"
$outLog = Join-Path $logDir "patap-lab-tunnel.log"
$errLog = Join-Path $logDir "patap-lab-tunnel.err.log"

if (-not (Test-Path -LiteralPath $tokenFile -PathType Leaf)) {
  throw "Token file not found: $tokenFile"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-PatapTunnelProcess $tokenFile
if ($existing) {
  Get-Process -Id $existing.ProcessId -ErrorAction Stop | Select-Object Id, ProcessName, Path, StartTime
  exit 0
}

$cloudflared = Resolve-PatapCloudflaredExecutable
$pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
[Environment]::SetEnvironmentVariable("PATH", $null, "Process")
[Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
$started = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "run", "--token-file", $tokenFile) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Start-Sleep -Seconds 2

$exact = Get-PatapTunnelProcess $tokenFile
if (-not $exact -or $exact.ProcessId -ne $started.Id) {
  $detail = if (Test-Path -LiteralPath $errLog) { (Get-Content -LiteralPath $errLog -Tail 20 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
  throw "PaTaP cloudflared tunnel did not stay running with the expected token file. PID=$($started.Id). $detail"
}

Get-Process -Id $exact.ProcessId -ErrorAction Stop | Select-Object Id, ProcessName, Path, StartTime
