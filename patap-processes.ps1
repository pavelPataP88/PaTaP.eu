Set-StrictMode -Version Latest

function Normalize-PatapPath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $null }
  try { return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\') } catch { return $PathValue.Trim().Trim('"').TrimEnd('\') }
}

function Test-PatapCommandLinePath([string]$CommandLine, [string]$ExpectedPath) {
  if ([string]::IsNullOrWhiteSpace($CommandLine) -or [string]::IsNullOrWhiteSpace($ExpectedPath)) { return $false }
  $expected = Normalize-PatapPath $ExpectedPath
  return $CommandLine.IndexOf($expected, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-PatapTunnelProcess([string]$TokenFile) {
  $expectedToken = Normalize-PatapPath $TokenFile
  return Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $command = [string]$_.CommandLine
      $command -match '(?i)(?:^|\s)tunnel\s+run(?:\s|$)' -and
      $command -match '(?i)(?:^|\s)--token-file(?:\s|=)' -and
      (Test-PatapCommandLinePath $command $expectedToken)
    } |
    Select-Object -First 1
}

function Get-PatapCaddyProcess([string]$ConfigFile) {
  $expectedConfig = Normalize-PatapPath $ConfigFile
  return Get-CimInstance Win32_Process -Filter "Name = 'caddy.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $command = [string]$_.CommandLine
      $command -match '(?i)(?:^|\s)run(?:\s|$)' -and
      $command -match '(?i)(?:^|\s)--config(?:\s|=)' -and
      (Test-PatapCommandLinePath $command $expectedConfig)
    } |
    Select-Object -First 1
}

function Resolve-PatapCloudflaredExecutable {
  $override = [Environment]::GetEnvironmentVariable('PATAP_CLOUDFLARED_EXE', 'Process')
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    if (-not (Test-Path -LiteralPath $override -PathType Leaf)) { throw "PATAP_CLOUDFLARED_EXE does not exist: $override" }
    return (Resolve-Path -LiteralPath $override).Path
  }

  $fromPath = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }

  foreach ($candidate in @(
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe')
  )) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
  }

  throw 'cloudflared.exe not found. Set PATAP_CLOUDFLARED_EXE, install cloudflared, or add it to PATH.'
}

function Resolve-PatapCaddyExecutable {
  $override = [Environment]::GetEnvironmentVariable('PATAP_CADDY_EXE', 'Process')
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    if (-not (Test-Path -LiteralPath $override -PathType Leaf)) { throw "PATAP_CADDY_EXE does not exist: $override" }
    return (Resolve-Path -LiteralPath $override).Path
  }

  $fromPath = Get-Command caddy.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe'
    $direct = Join-Path $wingetRoot 'caddy.exe'
    if (Test-Path -LiteralPath $direct -PathType Leaf) { return $direct }
    if (Test-Path -LiteralPath $wingetRoot -PathType Container) {
      $found = Get-ChildItem -LiteralPath $wingetRoot -Filter 'caddy.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($found) { return $found.FullName }
    }
  }

  throw 'caddy.exe not found. Set PATAP_CADDY_EXE, install Caddy, or add it to PATH.'
}
