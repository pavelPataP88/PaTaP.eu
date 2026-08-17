@echo off
echo Replace REPLACE_WITH_TUNNEL_UUID in cloudflared-config.yml first.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel route dns patap-lab patap.eu
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel route dns patap-lab www.patap.eu
