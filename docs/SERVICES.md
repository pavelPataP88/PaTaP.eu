# Services

`services/` contains shared capabilities. Services are not modules.

## Current Service Areas

```text
services/ai/
services/filesystem/
services/logging/
services/notifications/
services/sync/
services/updates/
```

## AI Rule

AI is a service.

AI is not a module.

Future providers:

```text
ChatGPT
Codex
DeepSeek
Kimi
```

Provider changes must not require business module rewrites.

## Service Contract

Services should expose stable interfaces to modules. Modules call a service capability; they do not own provider-specific code.
