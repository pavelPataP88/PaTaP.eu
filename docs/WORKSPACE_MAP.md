# Workspace Map

Карта рабочей папки `D:\WWW.PATAP.EU`.

## Публичный Runtime

Исходные файлы текущего UI:

```text
index.html
styles.css
app.js
assets/patap-lab-bg.png
```

Публичная сборка:

```text
var/build/dist/
```

Caddy отдаёт только `var/build/dist`, не весь корень проекта.

## PlatformOS

```text
core/
services/
modules/
system/registry.json
data/
```

`core/` - инфраструктура.  
`services/` - общие сервисы.  
`modules/` - независимые модули.  
`system/registry.json` - источник правды для загрузки модулей.

Текущий live UI ещё не перенесён полностью в `modules/lab`.

## Управление Сайтом

```text
Caddyfile.tunnel
start-origin.cmd
start-origin.ps1
stop-origin.cmd
stop-origin.ps1
start-patap-tunnel.ps1
stop-patap-tunnel.ps1
start-patap-stack.cmd
start-patap-stack.ps1
install-autostart.cmd
uninstall-autostart.cmd
```

Cloudflare token хранится вне проекта:

```text
%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt
```

## Документация

```text
README.md
docs/PROJECT_CONTEXT.md
docs/CURRENT_STATUS.md
docs/RUNBOOK.md
docs/CLOUDFLARE_TUNNEL.md
docs/ARCHITECTURE.md
docs/MODULE_SYSTEM.md
docs/CORE.md
docs/SERVICES.md
docs/FEATURE_WORKFLOW.md
docs/CHANGELOG.md
docs/WORKSPACE_MAP.md
features/README.md
```

## Feature Blocks

Новые блоки фиксируются здесь:

```text
features/<block-name>/block.md
```

Если блок становится самостоятельным модулем, он получает папку:

```text
modules/<module-name>/
```

и запись в:

```text
system/registry.json
```

## Runtime Data

```text
var/
data/
```

Эти папки считаются runtime-данными и игнорируются git. Публичная сборка в `var/build/dist` создаётся заново командой `npm run build`.
