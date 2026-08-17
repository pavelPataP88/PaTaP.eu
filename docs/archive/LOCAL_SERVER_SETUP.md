# Patap Lab Local Server Setup

Project folder:

```text
D:\WWW.PATAP.EU
```

Public IP detected:

```text
37.31.22.213
```

Local Wi-Fi IP detected:

```text
10.166.68.195
```

## OVH DNS

Do not change DNS yet. The latest external check shows public ports 80 and 443 are not reachable on the current T-Mobile connection.

Only use the DNS records below after an external check confirms that both ports are reachable from outside.

In OVH DNS zone for `patap.eu`, set:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `37.31.22.213` |
| CNAME | `www` | `patap.eu.` |

Current DNS check still shows:

```text
patap.eu A 213.186.33.5
```

That is the OVH parking/default page address. Replace it with `37.31.22.213`.

Remove or replace OVH parking records that point to the default construction page.

## Router / Gateway

Forward these ports to the laptop:

| External port | Protocol | Internal IP | Internal port |
| --- | --- | --- | --- |
| 80 | TCP | `10.166.68.195` | 80 |
| 443 | TCP | `10.166.68.195` | 443 |

The gateway shown by Windows is `10.166.68.5`.

Current public port check:

| Public IP | Port | Status |
| --- | --- | --- |
| `37.31.22.213` | 80 | closed |
| `37.31.22.213` | 443 | closed |

Caddy is listening locally, so closed public ports mean the remaining block is firewall, router port forwarding, or ISP/CGNAT.

## Windows Firewall

Allow inbound TCP ports:

- 80
- 443

Run PowerShell or Command Prompt as Administrator:

```powershell
cd D:\WWW.PATAP.EU
.\firewall-admin.cmd
```

The firewall rules could not be added from the current non-admin session because Windows returned `Access denied`.

## Caddy

Caddy serves the site directly from:

```text
D:\WWW.PATAP.EU
```

Start Caddy:

```powershell
cd D:\WWW.PATAP.EU
.\start-caddy.cmd
```

The command stays open while Caddy is running. Keep that window open, or later install Caddy as a Windows service.

Reload after config changes:

```powershell
.\reload-caddy.cmd
```

Stop:

```powershell
.\stop-caddy.cmd
```

## HTTPS

Caddy will automatically request and renew HTTPS certificates for:

- `patap.eu`
- `www.patap.eu`

This works only after:

1. OVH `A @` points to the current public IP.
2. OVH `CNAME www` points to `patap.eu.`
3. Router forwards ports 80 and 443 to `10.166.68.195`.
4. Windows Firewall allows ports 80 and 443.
5. Caddy is running.

Then open:

```text
https://patap.eu
```

## Important

If the ISP changes the public IP, update the OVH `A` record. For a permanent setup, ask the ISP for a static public IP or use dynamic DNS later.
