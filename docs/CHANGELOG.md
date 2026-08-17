# Changelog

## 2026-07-21 — Direct radio client

- Added the Driver Radio ES module and navigation view for private accepted-contact channels.
- Added hold-to-talk recording with browser `MediaRecorder`, a 60-second client boundary, a 3 MiB guard and explicit microphone/busy/upload states.
- Added CSRF-protected binary Blob upload using the server-issued one-use radio upload token and authenticated playback of committed transmissions.
- Added a Radio action to accepted-contact driver cards; non-contacts cannot open a channel.
- Radio channel/speaker freshness currently uses four-second polling. DP-003 WebSocket speaker events and physical-microphone E2E remain unverified/not implemented.
- Verified `npm run verify`: auth 9/9, Driver module 2/2, client 2/2 and PlatformOS checks passed.

## 2026-07-14 — Persistent reciprocal Driver GPS

- Replaced independent GPS and visibility controls with one server-persisted Driver switch.
- Added SQLite schema v6 `gps_enabled` state and automatic restore after refresh/login.
- Enforced reciprocal server policy: OFF users cannot publish or query nearby and are excluded from results; disabling atomically deletes the current location.
- Nearby queries now accept only a radius and derive the caller origin from its fresh stored location.
- Logout clears the live coordinate without clearing the saved ON preference.
- Added automated coverage for persistence, automatic restore, reciprocal visibility, OFF isolation, throttle, permission denial and logout behavior.

## 2026-07-13 — Driver DP-002 GPS + Map foundation

- Added locally shipped MapLibre GL JS 5.24.0 assets and a Driver map with replaceable OSM raster tile configuration and visible attribution.
- Added explicit, default-off GPS and independent default-off location visibility controls.
- Added throttled last-position publishing, permission/API failure handling, marker reconciliation and logout cleanup.
- Added SQLite schema v3 `driver_locations` storage with one current row per user and no location history.
- Added authenticated Driver location and nearby APIs with CSRF on writes, strict coordinate validation, fixed radii, stale-position filtering, own-user exclusion and server-side distance calculation.
- Tightened Driver CSP for the exact tile origin and MapLibre blob worker while keeping scripts and styles local.
- Expanded API, browser, build and verification coverage for DP-002.
- Verified the local stack and public Driver route. Chrome loaded the unauthenticated page without console errors or an automatic geolocation prompt; authenticated manual GPS E2E remains unclaimed because no shared Chrome session was active.

## 2026-07-13

### Driver Patap: verified foundation

- Добавлена отдельная рабочая оболочка Driver с отдельной сборкой `var/build/driver` и host-aware маршрутом Caddy для `driver.patap.eu`.
- Добавлена миграция SQLite v2 с таблицей `driver_profiles`, связанной с существующим `users.id`.
- Добавлены защищённые API чтения/сохранения профиля, уникальный регистронезависимый ключ никнейма, четыре допустимых типа водителя и аудит создания/изменения.
- Добавлен функциональный UI входа через существующий аккаунт Patap и создания/редактирования профиля.
- `/api/session` теперь обновляет старую host-only сессию в общие cookies доверенного домена.
- Перед изменением схемы создан backup `patap-auth-2026-07-13T18-29-12-635Z.sqlite` с успешным integrity check.
- Проверено: Caddy config valid; `npm run verify` PASS; 6 auth tests и 1 client test PASS.
- Публичный Driver не заявлен работающим: DNS и реальный Chrome cross-subdomain сценарий ещё не подтверждены.
- В Cloudflare Dashboard к существующему Tunnel `patap-lab` добавлен route `driver.patap.eu` на `http://127.0.0.1:8090`; Cloudflare автоматически создал CNAME.
- Публичный HTTPS endpoint вернул HTTP 200 с отдельным Driver HTML и ожидаемыми security headers. Chrome cross-subdomain auth пока не подтверждён из-за отрицательного DNS-кэша Chrome сразу после создания записи.

- Зафиксированы подтверждённая исходная точка, результаты первого голосования, контролируемый V1, архитектура и приёмочная матрица в `docs/DRIVER_PATAP_V1.md`.
- Перед auth-изменениями создана резервная копия SQLite с успешным `PRAGMA integrity_check`.
- Доверенный `driver.patap.eu` добавлен в CSRF allowlist.
- Для публичных Patap hosts auth теперь выдаёт общие cookies с `Domain=patap.eu`; локальные тестовые hosts сохраняют host-only cookies.
- `X-Forwarded-Host` учитывается только от локального reverse proxy.
- Добавлена очистка legacy host-only cookies при переходе на общую cookie и очистка обоих вариантов при logout.
- Добавлен isolated auth test для общей Patap/Driver-сессии, доверенного Driver origin, отклонения постороннего origin и logout cleanup.
- Публичный Driver, карта, GPS, чат, рация, парковки, друзья, уведомления и Driver admin ещё не заявлены готовыми.

## 2026-07-10

### Real Auth Admin System

- Added local Node auth backend on `127.0.0.1:8091`.
- Added SQLite auth database under `data/auth/patap-auth.sqlite`.
- Added server-side registration, login, logout, sessions, CSRF, rate limits and audit events.
- Added roles: `Owner`, `Administrator`, `User`.
- Added Owner bootstrap CLI: `npm run auth:bootstrap-owner`.
- Added protected admin APIs and minimal admin UI.
- Added admin-assisted reset token flow; public email reset is not claimed.
- Caddy now proxies `/api/*` to the local backend while serving only `var/build/dist`.
- `npm run verify` now includes auth API tests.

### Security Runtime Fixes

- Added canonical redirects to `https://patap.eu`.
- Added HSTS without preload.
- Added a minimal CSP compatible with the current static site.
- Updated local auth copy: reset is now `Сбросить локальный пароль`, with an explicit warning not to use a real password.
- Added password confirmation to local password reset.
- Cleared stale auth messages after successful login/register.
- Fixed post-register auth tab state.
- Fixed `start-patap-stack.ps1` status reporting: `OriginListening`, `CaddyRunning`, `TunnelRunning`.

### Security And Runtime Boundary

- Caddy переведён на отдачу только публичной сборки `var/build/dist`.
- `scripts/build.js` теперь падает, если отсутствуют обязательные публичные файлы или главный asset.
- Cloudflare token вынесен из `D:\WWW.PATAP.EU` в `%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt`.
- Tunnel-скрипты используют `--token-file`, raw token больше не передаётся в командной строке процесса.
- Проверены логи `var/logs`: raw token в них не найден.

### UI And Auth Honesty

- Русский текст `index.html` восстановлен в нормальном UTF-8.
- Публичный статус изменён с `Patap Lab Online` на честный `Локальный прототип`.
- UI прямо сообщает, что аккаунты и пароль сохраняются только в этом браузере и серверных аккаунтов пока нет.
- Неполный `role="tablist"` убран с кнопок выбора режима входа.

### Operations

- Добавлены/обновлены start/stop скрипты для origin и tunnel.
- Stop-скрипты больше не убивают все процессы `caddy.exe` или `cloudflared.exe`; они ограничены процессами Patap Lab.
- Автозапуск оставлен через Windows Startup и документирован как зависимый от пользовательской сессии Windows и интернета на ноутбуке.

### Verification

- `npm run verify` теперь запускает build.
- Проверяется, что Caddy смотрит на `var/build/dist`.
- Проверяется, что приватные папки и служебные файлы не попали в dist.
- Усилены проверки registry: уникальные id/route/path, boolean `enabled`, формат route, допустимые статусы и роли.
- Добавлены статические проверки базовых сценариев локального кабинета: регистрация, вход, выход, восстановление, карточки проектов, заметки и исследования.

## 2026-07-08

### PlatformOS

- Создана структура `core/`, `services/`, `modules/`, `system/`, `data/`.
- Добавлен `system/registry.json`.
- Добавлены module shells для `lab`, `transport`, `library`, `research`.
- Добавлены transport-папки: `truck`, `taxi`, `cargo`, `parking`, `maps`, `radio`, `chat`, `drivers`.
- Реализован тестируемый PlatformOS runtime в `core/runtime.js`.
- Добавлены runtime tests в `scripts/test-platformos-runtime.js`.

### Public Access

- Домен `patap.eu` делегирован на Cloudflare nameservers.
- Создан Cloudflare Tunnel `patap-lab`.
- Настроены public hostnames `patap.eu` и `www.patap.eu`.
- Подтверждено, что публичный доступ идёт через Tunnel, а не через T-Mobile public IP.
# 2026-07-13 — Driver Patap DP-003 recovery core

- Added SQLite schema v4 with a single immutable principal Owner and defense-in-depth API/database enforcement.
- Split CSP by host so MapLibre/OSM permissions apply only to Driver.
- Added CSRF-protected POST nearby queries that do not persist the query location; kept legacy GET temporarily.
- Started Driver modularization with a shared native ES-module API client and a server-side location repository.
- Added DP-003 vote provenance and an updated recovery/status record.
- Recorded implementation reviews actually received from GPT and Kimi, the missing DeepSeek response, E dissent mitigation, and the legacy nearby GET removal target.
