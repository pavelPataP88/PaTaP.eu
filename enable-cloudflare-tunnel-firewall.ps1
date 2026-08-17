$ErrorActionPreference = "Stop"

$cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
  throw "cloudflared.exe not found: $cloudflaredPath"
}

$rules = @(
  @{ Name = "Patap Cloudflare Tunnel TCP 7844"; Protocol = "TCP"; RemotePort = "7844" },
  @{ Name = "Patap Cloudflare Tunnel UDP 7844"; Protocol = "UDP"; RemotePort = "7844" },
  @{ Name = "Patap Cloudflare Tunnel TCP 443"; Protocol = "TCP"; RemotePort = "443" }
)

foreach ($rule in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-NetFirewallRule -DisplayName $rule.Name -Direction Outbound -Action Allow -Program $cloudflaredPath -Protocol $rule.Protocol -RemotePort $rule.RemotePort -Profile Any | Out-Null
  }
}

Get-NetFirewallRule -DisplayName "Patap Cloudflare Tunnel *" |
  Get-NetFirewallPortFilter |
  Select-Object Protocol, RemotePort
