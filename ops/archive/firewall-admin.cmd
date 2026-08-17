@echo off
netsh advfirewall firewall add rule name="Patap Lab HTTP 80" dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="Patap Lab HTTPS 443" dir=in action=allow protocol=TCP localport=443
