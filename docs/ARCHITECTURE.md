# Architecture

Patap Lab is being migrated toward `PlatformOS`.

The migration is incremental. The existing production site remains active from root files while the new architecture is built beside it.

## Current Production Path

```text
Browser
  -> Cloudflare HTTPS
  -> Cloudflare Tunnel
  -> Caddy origin http://127.0.0.1:8090
  -> host patap.eu: D:\WWW.PATAP.EU\var\build\dist
  -> host driver.patap.eu: D:\WWW.PATAP.EU\var\build\driver
  -> shared /api/* backend: http://127.0.0.1:8091
```

## Target PlatformOS Shape

```text
core/
services/
modules/
system/
data/
docs/
```

## Core

Infrastructure only:

- router
- navigation
- auth
- permissions
- config
- events
- ui
- storage

No business logic in `core/`.

## Services

Shared capabilities:

- ai
- filesystem
- logging
- notifications
- sync
- updates

AI is a service, not a module.

## Modules

Business areas live in `modules/`.

Current module targets:

- `lab`
- `transport`
- `library`
- `research`

Each module is independent, removable, and replaceable.

## Registry

All modules are loaded only through:

```text
system/registry.json
```

Implemented runtime entry:

```text
core/runtime.js
```

The runtime loads registry entries, validates manifests, builds a launcher from enabled modules, and opens modules through a router. Disabled modules are not shown in the launcher. Module failures are recorded and do not stop remaining valid modules from loading.

Adding a module means:

1. Create module folder.
2. Add module manifest and required files.
3. Add registry entry.
4. Verify.

No core modification.

## UI Target

After login:

- workspace
- module launcher
- cards generated from `system/registry.json`

No hardcoded menu in the target architecture.

Current UI is still the legacy root UI during migration. It is built into `var/build/dist` before Caddy serves it.

## Security

Never publish:

- `*.token`
- `*.secret`
- `.cloudflared*`
- passwords
- keys
- `core/`
- `services/`
- `modules/`
- `system/`
- `data/`
- `docs/`
- `ops/`
- `var/`

Caddy serves only `var/build/dist`. The deny rules in `Caddyfile.tunnel` are additional protection, not the primary security boundary.
