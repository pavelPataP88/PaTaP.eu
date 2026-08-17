# Core

`core/` contains PlatformOS infrastructure only.

Core may contain:

- router
- navigation
- auth
- permissions
- config
- events
- ui
- storage

Core must not contain business logic for lab, transport, library, research, AI providers, drivers, cargo, maps, radio, or chat.

Adding a module must not require core changes. Modules are discovered through `system/registry.json`.
