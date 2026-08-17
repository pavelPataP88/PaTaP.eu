# Project Map

Root: `D:\WWW.PATAP.EU`

## Runtime

The current production runtime is preserved:

```text
index.html
styles.css
app.js
assets/patap-lab-bg.png
Caddyfile.tunnel
start-origin.cmd
start-patap-tunnel.ps1
```

Local origin:

```text
http://127.0.0.1:8090
```

Public gateway:

```text
Cloudflare Tunnel -> Caddy -> D:\WWW.PATAP.EU
```

## PlatformOS Structure

```text
core/
services/
modules/
system/
data/
docs/
ops/
scripts/
var/
```

## Core

Infrastructure only:

```text
core/router/
core/navigation/
core/auth/
core/permissions/
core/config/
core/events/
core/ui/
core/storage/
```

No business logic belongs in `core/`.

## Services

Shared capabilities:

```text
services/ai/
services/filesystem/
services/logging/
services/notifications/
services/sync/
services/updates/
```

AI is a service, not a module.

## Modules

Modules are independent and loaded through `system/registry.json`.

```text
modules/lab/
modules/transport/
modules/library/
modules/research/
```

Each module must have:

```text
manifest.json
index.html
styles.css
app.js
assets/
config/
README.md
```

## Data

Prepared storage areas:

```text
data/users/
data/modules/
data/projects/
data/logs/
data/cache/
data/uploads/
data/config/
```

Current runtime still uses `localStorage`. The architecture must allow migration to filesystem, SQLite, or Postgres without rewriting modules.
