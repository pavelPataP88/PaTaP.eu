# T-Mobile Inbound Check

Do not change DNS for `patap.eu` yet.

## Current Result

External port-check service result:

```json
{ "ip": "37.31.22.213", "port": 80, "reachable": false }
{ "ip": "37.31.22.213", "port": 443, "reachable": false }
```

Local network result:

```text
Laptop IPv4: 10.166.68.195
Gateway: 10.166.68.5
Public IP: 37.31.22.213
```

Caddy is listening locally on ports 80 and 443, but the public IP is not reachable from outside.

## Conclusion

Do not set:

```text
A @ -> 37.31.22.213
```

until an external port check returns reachable=true for both 80 and 443.

With the current T-Mobile mobile internet path, inbound public connections are not working. The likely cause is mobile NAT/CGNAT, hotspot NAT, firewall, or operator port blocking. For a normal public website, an A record only works when the public IP can actually accept incoming TCP connections.

## No-Hosting Options That Keep Files On This Laptop

These options do not move the website files away from `D:\WWW.PATAP.EU`.

### Option A: Reverse Tunnel

Run the website on the laptop and expose it through an outbound tunnel. This works even when T-Mobile blocks inbound ports because the laptop connects out to the tunnel provider.

Possible tunnel providers:

- Cloudflare Tunnel
- Tailscale Funnel
- ngrok
- LocalTunnel

For the public domain `patap.eu`, the cleanest tunnel setup needs a DNS record pointing to the tunnel endpoint, not to the T-Mobile IP.

### Option B: Remote Reverse Proxy

Use a very small free/cheap external server only as a proxy, while files and Caddy remain on the laptop. The proxy forwards traffic over an outbound SSH or WireGuard tunnel to the laptop.

This is not website hosting, but it does use a public relay machine.

### Option C: Ask T-Mobile For Public IPv4

If T-Mobile can provide a real public IPv4 with inbound ports 80 and 443 open, then direct `A @ -> public IP` becomes possible.

Only after that should DNS be changed.

## DNS Rule

Change OVH DNS only after:

1. Caddy is running locally.
2. Windows Firewall allows 80 and 443.
3. The network forwards 80 and 443 to the laptop.
4. External checks show:

```text
37.31.22.213:80 reachable=true
37.31.22.213:443 reachable=true
```

Until then, keep OVH DNS unchanged.
