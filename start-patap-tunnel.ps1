$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tokenFile = Join-Path $env:LOCALAPPDATA "PatapLab\cloudflared\patap-lab-token.txt"
$logDir = Join-Path $root "var\logs"
$outLog = Join-Path $logDir "patap-lab-tunnel.log"
$errLog = Join-Path $logDir "patap-lab-tunnel.err.log"

function Resolve-Cloudflared {
  $fromPath = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $known = @(
    "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    "C:\Program Files\cloudflared\cloudflared.exe"
  )

  foreach ($candidate in $known) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "cloudflared.exe not found. Install cloudflared or add it to PATH."
}

if (-not (Test-Path -LiteralPath $tokenFile)) {
  throw "Token file not found: $tokenFile"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*tunnel run*" -and $_.CommandLine -like "*patap-lab-token.txt*" }

if ($existing) {
  Get-Process -Id $existing.ProcessId -ErrorAction Stop | Select-Object Id, ProcessName, Path, StartTime
  exit 0
}

$cloudflared = Resolve-Cloudflared
$pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
[Environment]::SetEnvironmentVariable("PATH", $null, "Process")
[Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "run", "--token-file", $tokenFile) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Start-Sleep -Seconds 2
Get-Process cloudflared -ErrorAction Stop | Select-Object Id, ProcessName, Path, StartTime
