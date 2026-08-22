# Current Engineering State — PaTaP.eu

**Purpose:** this is the current, safe starting point for AI work. It describes what is actually deployed and tested, not an idea or a wish list.

## Source of truth

- Working code snapshot: `codex/local-workspace-snapshot`.
- The production machine is a Windows laptop. GitHub is an engineering mirror, not the production server.
- `main` must not be changed without an explicit owner decision.
- The local working directory is `D:\\WWW.PATAP.EU`.

## What is currently working

### Driver map and road events

The map block is deployed and locally verified:

- voluntary GPS and privacy-aware clearing;
- nearby drivers, clustering and different driver labels;
- five structured road-event types: accident, road work, obstacle, road control, transport inspection;
- optional lane only for accident/road work;
- event creation uses fresh voluntary GPS; no free text or photos;
- guest map is read-only and MapLibre remains lazy;
- event lifetime, freshness display, peer confirmation and safe offline queue guards;
- map layers, location accuracy, follow/free/heading modes, nearby/ahead summaries;
- initial authorized map zoom is at least 11; first fresh GPS focuses once at least to zoom 14; later GPS updates do not force zoom changes; `⌖` returns to the driver.

Relevant code: `driver/map/`, `driver/gps/index.js`, `server/road-reports/`, `server/driver/routes.js`.

### Chat and radio

- Driver chat has four fixed reactions: 👍, ✅, 👀, ❤️.
- General and direct radio exist. Direct radio requires an accepted contact.
- Audio uploads are protected by a pending transmission lease and upload token. A failed/oversized upload releases only its own lease so the channel is not blocked.

Relevant code: `driver/chat/index.js`, `driver/radio/index.js`, `server/chat/`, `server/radio/`.

## Historical baseline verification — 2026-08-18

This is the baseline before the later Chat Console V2 deployment. The current, authoritative results are in `AI_HANDOFF.md` and `docs/CURRENT_STATUS.md`.

- `npm ci` — PASS, 0 vulnerabilities.
- `npm run build` — PASS.
- `npm run verify` — PASS: auth 17/17, Driver modules 18/18, client browser scenarios 2/2, Caddy config 4/4.
- Map/Road Report focused tests — PASS, 17/17.
- `status-patap-stack.cmd` — HEALTHY: local site, API, Caddy, Cloudflare tunnel, `https://patap.eu` and public API returned HTTP 200.

At that moment the separate `npm run test:browser` runner could not open the public website because the sandbox browser denied external network access. This limitation was later resolved for the Chat Console V2 verification: its browser suite passed on the working laptop.

## Safety rules

Never publish or commit users, SQLite, GPS data, messages, radio uploads, tokens, passwords, logs, `data/`, `var/`, `node_modules/` or other runtime/private files.

Keep minimum registration password length **6**. Do not weaken CSRF, rate limits, session cookies, radio access checks or GPS/privacy checks.

## Radio experience v1 — deployed

- Large hold-to-talk control, active channel, visible recording/sending/delivery/error/busy states and recording timer are deployed.
- Short taps, drag-out release, Escape, blur and interrupted pointer interaction cancel safely.
- A delivery message is shown only after server confirmation or a confirmed channel lookup; unknown network outcome remains explicit.
- UI layout was corrected so transmission actions remain usable in the scrollable list.
- All local verification passed; two-driver real-device smoke remains a manual follow-up.

## Radio Console v2 — deployed

- Radio Console добавляет общий эфир, публичные и закрытые каналы, роли, приглашения, moderation, избранное, mute, непрочитанные передачи, закрепления, Driving Mode и доступный PTT.
- Near-live голос передаётся по PCM через HTTPS/SSE только транзитом, параллельно с подтверждённой сохранённой историей. Короткий tap до 550 мс в эфир не попадает.
- Server-side policy, role и membership changes immediately revoke active PTT lease. Без сессии radio overview возвращает 401.
- Автотесты, build, verify и browser test фактически прошли на рабочем ноутбуке. Реальный двухустройственный smoke микрофона/динамика остаётся ручной проверкой.

## Chat Console v2 — deployed

- Общие, личные и групповые чаты; роли, приглашения, поиск, вложения, голосовые сообщения, опросы, ответы, редактирование, удаление и закрепления.
- Блокировки Driver остаются серверным ограничением личных чатов.
- Минимальная регистрационная длина пароля остаётся **6** символов.
- `npm ci`, auth 20/20, radio live 1/1, Driver modules 40/40, client 2/2, config 4/4, build, verify и browser suite фактически прошли 19 августа 2026 года.
- Ручная проверка с двумя временными аккаунтами и устройствами для вложений, голоса, ролей и блокировки остаётся обязательным следующим smoke-сценарием.

## People & Communities v1 — deployed

- People Console, серверная приватность, направленное доверие и закрытые/открытые сообщества развёрнуты.
- Один Community синхронизирует membership и роли своего Chat GROUP и Radio GROUP; несинхронные standalone-mutations возвращают `409 community_managed`.
- Добавочная People schema v1 активирована после локального backup SQLite. Глобальная auth schema остаётся 12.
- Полный набор локальных автоматических тестов и browser smoke прошёл 19 августа 2026 года.
- Нужен только ручной temporary-account smoke на двух/трёх устройствах.

## Current next block

No coding block is active. Read `AI_TASK.md` and `AI_HANDOFF.md` before proposing a new small block from the current snapshot.
