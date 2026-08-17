# Core

`core/` is PlatformOS infrastructure.

Allowed areas:

```text
router
navigation
auth
permissions
config
events
ui
storage
```

## Hard Rule

Core contains infrastructure only.

Core must not contain:

- Lab business logic
- Transport business logic
- Truck/taxi/driver logic
- Library content logic
- Research content logic
- AI provider logic

## Auth

Target model:

- single account
- multi-module permissions
- role-based access

Roles:

```text
Administrator
Developer
Researcher
TruckDriver
TaxiDriver
Guest
```

Current implementation is local browser auth in root `app.js`. It stays untouched until a safe migration step is planned.

## Storage

Core storage must expose stable interfaces so modules do not care whether data is stored in:

- localStorage
- filesystem
- SQLite
- Postgres

## Runtime Implementation

Implemented runtime files:

```text
core/runtime.js
core/config/registry-loader.js
core/config/manifest-loader.js
core/config/runtime-schema.js
core/storage/file-source.js
core/navigation/module-launcher.js
core/router/module-router.js
core/events/runtime-events.js
```

Startup sequence:

```text
load registry
validate registry
load module manifests
ignore disabled modules for launcher/opening
build launcher from enabled modules
open modules through router
continue when one module fails
```

`system/registry.json` is the only source of truth for module discovery.
