[2026-08-22 Europe/Warsaw] FROM: CODEX
BLOCK: NEW_CHAT_ONBOARDING
STATUS: CURRENT_CONTEXT_PUBLISHED

New ChatGPT must use `docs/AI_NEW_CHAT_START.md` as the single current entry point.

- Current safe source-of-truth: `codex/local-workspace-snapshot @ 9745b5145bce247d3cce6b3f9a67fbd983a0011c`.
- Latest deployed source: `chatgpt/commercial-hardening-v1-work @ 0dbfb137758a0d2c8dc62866079002740e50a4e1`.
- Its Windows verification, preflight, encrypted external DR restore drill, deployment and public smoke are factual PASS. See the detailed `COMMERCIAL_HARDENING_V1` entry further below.
- Navigation is still BLOCKED_PROVIDER; no real reviewed truck router is configured.
- No new coding block is active. First action is to propose one small, testable block from the current snapshot.

---
[2026-08-20 Europe/Warsaw] FROM: CODEX
BLOCK: NAVIGATION_ENGINE_V1
TASK_ID: NAVIGATION-20260820-003
STATUS: BLOCKED_PROVIDER — AUTOMATION PASS, NOT DEPLOYED

Candidate verified exactly:
- Branch: chatgpt/navigation-engine-v1
- HEAD checked: e7391a2fa9f7aafa98be69e8ae9d065bf70298b5
- Product code/tests commit in its ancestry: fbcf3ea67ddb67ddb530dd4b130cf4fddbeb1b7a
- Confirmed base: codex/local-workspace-snapshot @ e78ecbea105c1011a092d67f247b058f5fb2a692
- Verification took place only in D:\\WWW.PATAP.EU\\.navigation-e739-candidate, never in the working site directory.

Automated result — all PASS:
- node --check every 24 changed JS/MJS file — PASS.
- npm ci — PASS (0 vulnerabilities).
- npm run test:auth — PASS, 40/40.
- npm run test:radio-live — PASS, 1/1.
- npm run test:driver-modules — PASS, 76/76.
- npm run test:client — PASS, 2/2.
- npm run test:config — PASS, 4/4.
- npm run build — PASS.
- npm run verify — PASS, including workspace/platform checks and all above component suites.
- npm run test:browser — PASS, isolated database and test servers.

Provider gate — BLOCKED:
- NAV_ROUTER_URL was inspected without exposing its value in Process, User and Machine environment scopes; it is UNSET in all three.
- No local non-secret configuration file contains NAV_ROUTER_URL either.
- Therefore no real router exists to verify TRUCK, VAN or TAXI routes. The fake Valhalla test fixture was not used as a substitute for this gate.
- As a result, real Route Guard / vehicle limits / alternatives / ETA / Road Reports / Parking / reroute and offline/degraded behavior against a real provider are NOT claimed tested.

Not applied:
- No Navigation source code was copied to D:\\WWW.PATAP.EU.
- No candidate backend was connected to the real SQLite database, so no SQLite backup was needed or created for this rejected deployment attempt.
- No backend restart, production routing request, live-site change, main update, or runtime/private-data change occurred.
- Existing working site remains unchanged.

Small non-blocking observation:
- Node reports existing MODULE_TYPELESS_PACKAGE_JSON warnings while loading Driver ES modules. They do not fail tests and are unrelated to Navigation; do not change package module mode inside this block.

Next gate:
1. An owner must provide/configure a reviewed real routing provider through NAV_ROUTER_URL, with supported truck constraints documented.
2. Codex then repeats real TRUCK/VAN/TAXI smoke against that provider.
3. Only after those checks and a separate explicit owner deployment approval may Codex back up SQLite, apply Navigation and restart the necessary backend process.
4. Do not start Voice Assistant or alter Navigation architecture while this gate is blocked.

---
[2026-08-20 Europe/Warsaw] FROM: CODEX
BLOCK: NAVIGATION_ENGINE_V1
TASK_ID: NAVIGATION-20260820-002
STATUS: CHANGES_REQUIRED

Sources recomposed and checked:
- Full Navigation candidate: chatgpt/navigation-engine-v1 @ 8e0afa67483d6627f818ff0aadd02213c2a46139.
- Minimal GPS test correction: chatgpt/navigation-engine-v1-gps-test-fix-01 @ eeae1a9c2520537087a70c41b788204ded146639.
- The GPS correction is valid: no production rate limit changed; npm run test:auth is now PASS, 38/38.

Passed:
- node --check over every changed Navigation JS/MJS — PASS.
- npm ci — PASS.
- npm run test:auth — PASS, 38/38.
- npm run test:radio-live — PASS, 1/1.
- npm run test:client — PASS, 2/2.
- npm run test:config — PASS, 4/4.
- npm run build — PASS.

Blocking result:
- npm run test:driver-modules — FAIL: 72/76 passed, 4 failed. No production code was changed or deployed.

Exact failures and required minimal corrections:
1. tests/driver/navigation-search.test.mjs:41:
   - DatabaseSync returns rows with null prototypes, while the assertion expects ordinary object prototypes.
   - The values are correct: route-000000000002/CANCELLED and route-000000000003/ACTIVE.
   - Preserve the retention assertion but map/destructure DB rows into ordinary id/status values before deep comparison. Do not change navigation schema/trigger behavior.

2. tests/driver/navigation.test.mjs:70:
   - A broad static regex for fallback/car falsely matches the intentional Russian UI sentence stating that a passenger-car route is not substituted automatically.
   - The same test already asserts that sentence, and auth integration proves exactly one truck request/no car fallback.
   - Replace only this contradictory broad text regex with a precise structural assertion that does not reject the required no-car-fallback explanation. Keep the existing truck/no-fallback behavior assertions.

3. tests/driver/parking-network.test.mjs and 4. tests/driver/people-console.test.mjs:
   - Both still expect module-registry.json version 20260819-parking-v1.
   - Navigation correctly changes driver/app.js to version 20260820-navigation-v1.
   - Update only those stale cache-version expectations while retaining registry-load assertions. Do not revert the cache version and do not alter Parking/People behavior.

Do not change:
- production GPS rate limit;
- Navigation truck constraints/no-car-fallback/Route Guard;
- Caddy, main, runtime/private data, or unrelated product code.

Not done:
- npm run verify and npm run test:browser were not run after the failing mandatory Driver modules suite.
- Per provider gate, real NAV_ROUTER_URL and real TRUCK smoke were not attempted.
- No SQLite backup, candidate application, backend restart, production routing request, deployment or source-code sync occurred.
- Working site remains unchanged.

---
[2026-08-20 Europe/Warsaw] FROM: CODEX
BLOCK: NAVIGATION_ENGINE_V1
TASK_ID: NAVIGATION-20260820-001
STATUS: CHANGES_REQUIRED

SOURCE_BRANCH: chatgpt/navigation-engine-v1
SOURCE_CODE_TESTS_REVIEWED: 8e0afa67483d6627f818ff0aadd02213c2a46139
BASE_CONFIRMED: codex/local-workspace-snapshot @ e78ecbea105c1011a092d67f247b058f5fb2a692

Checks completed:
- Candidate merge-base exactly matches e78ecbea105c1011a092d67f247b058f5fb2a692.
- node --check — PASS for all 22 changed JS/MJS files.
- Static contract review: Navigation has no view and depends on map; exactly six Driver navigation views remain. Public Nominatim hostname is rejected. No hgv_no_access_penalty remains. Tests assert truck costing and no automatic car fallback.
- npm ci — PASS.
- npm run test:auth — FAIL: 37/38 passed, 1 failed. This blocks all later required suites and all provider/production checks.

Exact failure:
- tests/auth/navigation.test.js:63, “Navigation route ownership, selection and reroute preserve the original strict vehicle snapshot”.
- Expected HTTP 200 from setLocation(), got 429 location_rate_limited at tests/auth/navigation.test.js:27 / 69.
- The first Navigation test already calls setLocation(primary, ...) for the same Driver. The next test immediately calls it again. Existing production rate protection in server/driver/routes.js:303 allows one Driver location update per 12 seconds. This is an existing safety control and must not be relaxed for Navigation tests.

Required minimal correction from ChatGPT:
1. Create a small fix branch from the current authoritative snapshot.
2. Correct only the new Navigation test's time/rate-limit sequencing. For this test, the already stored fresh GPS location is sufficient for route refresh; remove the redundant immediate location write or use a deterministic test clock/fixture without changing production rate limits.
3. Preserve the intent: route ownership, selection and refresh must still prove the original strict truck vehicle snapshot is used.
4. Do not weaken any existing Map/GPS/Road test or server rate limiting. Do not alter truck/no-car-fallback safety behavior.
5. Record exact branch/commit in AI_HANDOFF.md.

Not done:
- npm run test:radio-live, test:driver-modules, test:client, test:config, build, verify and browser were not accepted/run after mandatory auth failure.
- Per the required gate, NAV_ROUTER_URL and real TRUCK provider smoke were not attempted.
- No SQLite backup, candidate application, backend restart, production routing request, deployment or source-code sync occurred.
- Working site, main and runtime/private data remain unchanged.

---
[2026-08-20 Europe/Warsaw] FROM: CODEX
BLOCK: EVENT_CENTER_V1
TASK_ID: EVENT-CENTER-20260820-DEPLOY-001
STATUS: DEPLOYED

Sources accepted:
- Self-contained candidate: chatgpt/event-center-v1-road-fix-01 @ 90d061f9bc4245bc11f18b88187c6339d7742e55.
- Full Event Center composition, syntax correction and Road distance-helper correction were reviewed. The Road helper now comes from server/road-reports/repository.js, whose existing behavior is exercised by both old and new tests.

Applied to D:\\WWW.PATAP.EU:
- Global Event Center: durable inbox, priorities, read/archive/snooze, per-category/source preferences, Driving Mode, quiet hours, in-app SSE, global bell/drawer and structured deep-links.
- Event projections for Chat, People/Communities, committed Radio, nearby Road reports and changed Parking availability.
- Privacy-preserving Web Push foundation: explicit opt-in, local VAPID key material, strict approved endpoint hosts and wake-only payloads.
- Six-button Driver bottom navigation remains six; Event Center is the global bell, not a seventh bottom item.
- Small local operational correction: start-backend.ps1 used invalid [bool](if (...)) syntax while formatting its status after successfully starting the backend. Changed only to [bool]$(if (...)); verified normal script output and health.

Factual checks on the candidate and then again on the applied local workspace:
- npm ci — PASS.
- node --check server/events/repository.js and server/events/service.js — PASS.
- npm run test:auth — PASS, 31/31.
- npm run test:radio-live — PASS, 1/1.
- npm run test:driver-modules — PASS, 62/62.
- npm run test:client — PASS, 2/2.
- npm run test:config — PASS, 4/4.
- npm run build — PASS.
- npm run verify — PASS, including PlatformOS runtime checks and all component suites.
- npm run test:browser — PASS using an isolated database and test servers.
- Local SQLite backup created before backend startup: data/auth/backups/patap-auth-2026-08-20T15-35-22-753Z.sqlite (not published).
- Only backend was stopped/restarted using stop-backend.ps1/start-backend.ps1. The corrected start script reports SupervisorRunning=True and BackendHealth=True; local /api/health returned HTTP 200.
- Public HTTP after restart: https://patap.eu, https://driver.patap.eu, https://patap.eu/api/health and https://driver.patap.eu/api/health each returned HTTP 200.

Safety:
- main was not changed.
- Runtime/private data was not placed in GitHub: SQLite and backups, users, GPS, messages, Event records, PushSubscription endpoints, VAPID keys, media, tokens, passwords, logs, data/, var/ and node_modules remain excluded.
- Existing registration/password behavior was not changed; minimum remains 6 characters.

Manual follow-up, explicitly not claimed:
- two-account signed-in UI flow for bell/deep links/mute/snooze/Driving Mode;
- a genuine two-device Road/Parking/Chat event flow;
- real-device browser Web Push permission and delivery. Automated VAPID/privacy tests PASS, but no real device notification is claimed.

---
[2026-08-20 Europe/Warsaw] FROM: CODEX
BLOCK: EVENT_CENTER_V1
TASK_ID: EVENT-CENTER-20260820-002
STATUS: CHANGES_REQUIRED

Sources checked:
- Full Event Center source: chatgpt/event-center-v1 @ ef697536f02d6e8d6a65ef88e4b18728be2fd397.
- Syntax fix: chatgpt/event-center-v1-syntax-fix-01 @ 0432fb74fc4717d805c97c99c19163a29e51a829.
- Note: the syntax-fix branch itself is not a self-contained Event Center candidate: against base a07c960 it adds only server/events/repository.js plus handoff/docs. Codex therefore tested the full original Event Center with exactly the one corrected repository file only in an isolated temporary checkout. Nothing was copied to production.

What passed:
- node --check server/events/repository.js — PASS after the syntax correction.
- npm run test:auth started and completed 31 tests: 29 PASS, 2 FAIL.

Blocking functional regression:
- Creating a Road Report now returns HTTP 500 instead of 201. It breaks both the new Event Center Road test and the pre-existing Road Report regression.
- Exact failing tests:
  1. tests/auth/event-center.test.js:47 — “Event Center creates URGENT nearby road events and exposes SSE readiness”: expected 201, got 500.
  2. tests/auth/road-reports.test.js:91 — “road report API keeps guest list safe and requires nearby fresh GPS for peer confirmations”: expected 201, got 500.
- Exact backend error:
  TypeError: haversineKm is not a function
  at Object.roadReport (server/events/service.js:75)
  called from server/driver/routes.js:117.
- Root cause: server/events/service.js imports { haversineKm } from ../driver/location, but server/driver/location.js does not export it. The existing supported helper is exported by server/road-reports/repository.js (and a separate Parking helper also exists). Event Center must use the correct shared/helper import without duplicating incompatible distance logic.

Required minimal correction from ChatGPT:
1. Create a self-contained Event Center candidate branch from current codex/local-workspace-snapshot, containing full EVENT_CENTER_V1 plus both fixes (syntax + correct haversine helper import).
2. Change only the faulty Event Center distance dependency/usage and the necessary handoff/test coverage. Do not change Road Reports behavior or weaken either failing assertion.
3. Retain the existing test proving a Road create returns 201 and nearby recipients receive the urgent event.
4. Record exact code commit in AI_HANDOFF.md.

Not done:
- Because the mandatory auth suite fails, npm run test:radio-live, test:driver-modules, test:client, test:config, build, verify and browser test were not accepted/rerun for this candidate.
- No real SQLite backup, backend start/restart, production deployment, Event Center manual smoke or Web Push device test occurred.
- Working site remains unchanged; main and runtime/private data remain untouched.

---
[2026-08-20 Europe/Warsaw] FROM: CODEX
BLOCK: EVENT_CENTER_V1
TASK_ID: EVENT-CENTER-20260820-001
STATUS: CHANGES_REQUIRED

SOURCE_BRANCH: chatgpt/event-center-v1
SOURCE_HEAD_REVIEWED: ef697536f02d6e8d6a65ef88e4b18728be2fd397
BASE_CONFIRMED: codex/local-workspace-snapshot @ 60e939aa8c9d72ecf78d39d6c5c371b8c8cd8d96

Blocking factual failure:
- npm ci completed in a separate candidate checkout.
- npm run test:auth did not start its isolated backend because Node failed to parse the new file server/events/repository.js.
- Exact location: server/events/repository.js:39, function categoryPreferences(userId).
- Exact error: SyntaxError: Unexpected token ')' (Node.js v24.16.0).
- Independent node --check across every changed JS/MJS file reproduces the same failure in only server/events/repository.js.

Required minimal correction from ChatGPT:
1. Create a small fix branch based on the current authoritative snapshot, repairing only the unmatched parenthesis / syntax in categoryPreferences.
2. Keep the Event Center product design and existing tests intact; do not weaken any tests.
3. Add or retain a direct syntax/load regression check if appropriate.
4. Record the new branch and exact commit in AI_HANDOFF.md.

Not done:
- No candidate file was copied to D:\\WWW.PATAP.EU.
- No real SQLite backup, candidate backend start, build, verify, browser test, restart, deployment, Web Push test, or production action occurred.
- Working site remains unchanged; main and runtime/private data remain untouched.

---
[2026-08-20 Europe/Warsaw] FROM: CODEX
BLOCK: PARKING_NETWORK_V1
TASK_ID: PARKING-NETWORK-20260820-DEPLOY-001
STATUS: DEPLOYED

Source reviewed and applied:
- ChatGPT Parking source: chatgpt/parking-network-v1 @ 6e08442b34b2596da7c87929a771b9cfb8fd9c00.
- ChatGPT test-only correction: chatgpt/parking-network-v1-test-fix-01 @ eb2374997ca5e4e7fff281ab78155bee6570d9bf.
- Codex small mobile fix: sixth Driver navigation item caused a second phone row because CSS reserved five columns. Mobile bar now uses six equal columns, still checked at <=56px and without horizontal overflow. This was not a product redesign.

Applied:
- Parking Network: canonical places, source metadata, vehicle-fit search, favorites, reviews, corrections, protected photo upload, live occupancy constrained by fresh nearby Driver GPS, prediction marked explicitly as prediction, map focus bridge and separate import commands.
- Parking schema is additive and module-local; global auth migration remains 12.
- No actual OSM/DATEX/operator data import was run. Therefore Parking has no invented external parking data; it can show future imported or community-provided places only.
- Import code is separate from Driver HTTP and was not executed.

Factual checks on D:\\WWW.PATAP.EU:
- npm ci — PASS, 0 vulnerabilities.
- npm run build — PASS.
- npm run test:auth — PASS, 28/28.
- npm run test:radio-live — PASS, 1/1.
- npm run test:driver-modules — PASS, 57/57.
- npm run test:client — PASS, 2/2, including six-button 390px mobile bar.
- npm run test:config — PASS, 4/4: Driver hostname, static cache and no-store dynamic responses.
- npm run test:browser — PASS using isolated database and test servers.
- npm run verify — PASS (all of the above component suites).
- Local SQLite backup created before restart and not published.
- Only the Node backend was restarted through stop-backend.ps1/start-backend.ps1. Local /api/health returned 200.
- Public HTTP checks after restart: https://patap.eu, https://driver.patap.eu and both /api/health endpoints returned HTTP 200.

Safety:
- main was not changed.
- Runtime/private data was not placed in GitHub: SQLite, users, GPS, messages, parking photos, radio/chat uploads, tokens, passwords, logs, data/, var/ and node_modules remain excluded.

Manual follow-up, not claimed complete:
- Use temporary test accounts/devices to create a community parking, submit live occupancy from a nearby fresh GPS position, upload/delete a genuine image, and verify visibility for a second signed-in driver.
- Do not run a real country import until a separately reviewed source/licence choice is approved.

---
[2026-08-20 Europe/Warsaw] FROM: CODEX
BLOCK: PARKING_NETWORK_V1
TASK_ID: PARKING-NETWORK-20260820-MOBILE-NAV-001
STATUS: CHANGES_REQUIRED

Candidate combination checked:
- Production Parking code: chatgpt/parking-network-v1 @ 6e08442b34b2596da7c87929a771b9cfb8fd9c00.
- Test-only correction: chatgpt/parking-network-v1-test-fix-01 @ eb2374997ca5e4e7fff281ab78155bee6570d9bf.
- npm run test:driver-modules — PASS, 57/57.
- npm run test:client — FAIL only in candidate. Current deployed local base runs the same suite PASS, 2/2, so this is a Parking regression.

Exact cause:
- driver/module-registry.json now creates 6 visible Driver navigation buttons: Карта, Паркинги, Чат, Рация, Профиль, Люди.
- driver/styles.css mobile rule (@media max-width:1100px) still has grid-template-columns: repeat(5, minmax(0,1fr)).
- The sixth button wraps to a second row at 390px, so tests/browser/client-storage.test.js reports #driver-nav height > 56. The existing test also still expects 5 buttons and must be updated to 6 while retaining all layout assertions.

Required minimal fix:
1. Change only the mobile Driver navigation layout in driver/styles.css so all 6 buttons remain in one 56px-or-less bottom bar at 390px. Keep labels readable, no horizontal page overflow, and preserve keyboard accessibility.
2. Update tests/browser/client-storage.test.js expected visible Driver nav button count from 5 to 6. Keep the nav-height/overflow assertions; do not weaken them.
3. Add a focused regression assertion if needed for 6-button mobile navigation.
4. No changes to Parking backend/schema/import, auth, Caddy, runtime data, or unrelated UI.

Not done:
- npm run build / verify / test:browser were not run after the failed client suite.
- Parking is not copied to D:\\WWW.PATAP.EU, no backup/restart/deploy/import happened.

---
[2026-08-19 Europe/Warsaw] FROM: CODEX
BLOCK: PARKING_NETWORK_V1
TASK_ID: PARKING-NETWORK-20260819-001
STATUS: CHANGES_REQUIRED

SOURCE_BRANCH: chatgpt/parking-network-v1
SOURCE_COMMIT_REVIEWED: 6e08442b34b2596da7c87929a771b9cfb8fd9c00
BASE_CONFIRMED: codex/local-workspace-snapshot @ 53b973221540b80d782426a58ade532eb89ab92e

What Codex actually checked:
- Compared candidate base and current local files: all 7 modified existing files match exactly after normalizing line endings. No newer local code would be overwritten.
- Static review found the Parking schema is additive and module-local; photo files use DATA_DIR/parking, are authenticated, no-store and nosniff; live occupancy requires enabled, fresh GPS and <=3 km. No import script runs in Driver HTTP.
- npm ci — PASS, 0 vulnerabilities.
- npm run test:auth — PASS, 28/28, including all 5 Parking integration tests.
- npm run test:radio-live — PASS, 1/1.
- npm run test:driver-modules — FAIL, 55/57. Production code assertions passed; exactly two stale test expectations failed.

Required minimal test-only fix:
1. tests/driver/parking-network.test.mjs:34 expects /Plan Б/ but the same candidate renders the valid UI label “План Б рядом” with a normal Russian capital Б. Update the assertion to match the actual intended text precisely (or an equivalently meaningful pattern). Do not change Parking product code just to satisfy a typo-like test.
2. tests/driver/people-console.test.mjs:23 still expects old cache query /module-registry.json?v=20260819-people-v1/. Parking correctly changed it to v=20260819-parking-v1. Update the old People assertion to the new current registry version; preserve the assertion that the registry is actually loaded.

Not done:
- No candidate files copied to D:\\WWW.PATAP.EU.
- No build, verify, browser test, SQLite backup, backend restart, deployment, OSM/DATEX import or production data change.
- No runtime/private data was touched or published.

Next required from ChatGPT:
- Create a small test-only fix branch based on the current snapshot, containing only the two test expectation updates and a handoff record.
- Do not start another feature block. Codex will rerun the full suite after the fix.

---

[2026-08-19 Europe/Warsaw] FROM: CODEX
BLOCK: PEOPLE_COMMUNITIES_V1
TASK_ID: PEOPLE-COMMUNITIES-20260819-001
STATUS: DEPLOYED

SOURCE_BRANCH: chatgpt/people-communities-v1
SOURCE_COMMITS: 45f25efe7467aa75b98ec39cdfbafc3d44ec186f (code/tests); d55bdbcfbc4b096a2b301729b5b3b9334b82ff9c (handoff)

Applied:
- People Console replaces the basic Contacts view: contacts, favorites, trusted contacts, private notes, nearby, requests, communities, blocks and driver search.
- Server-side People privacy now controls discoverability, requests, vehicle visibility and both People Nearby and old exact map markers.
- Community member graph is synchronized with linked private Chat GROUP and Radio GROUP; standalone membership actions return 409 community_managed.
- SQLite schema is additive and module-local; global auth migration remains 12.
- Codex updated only the existing browser test mock and its card-click selector for the intended People API/UI. GPS assertions remain unchanged.

Factual checks:
- npm ci — PASS.
- npm run test:auth — PASS, 23/23.
- npm run test:radio-live — PASS, 1/1.
- npm run test:driver-modules — PASS, 47/47.
- npm run test:client — PASS, 2/2.
- npm run test:config — PASS, 4/4.
- npm run verify — PASS.
- npm run test:browser — PASS.
- SQLite backup created locally before backend restart; not published.
- Backend health — HTTP 200. Public patap.eu and driver.patap.eu opened successfully; guest Driver remains read-only and console-error-free.

Manual follow-up (not claimed as completed):
- Use temporary accounts on two or three devices to exercise Community membership/roles/ban/owner transfer, People privacy and real media/PTT in a Community.

---
[2026-08-19 Europe/Warsaw] FROM: CODEX
BLOCK: REPOSITORY_HYGIENE
STATUS: COMPLETED

- Единственная инженерная точка входа: `codex/local-workspace-snapshot`. Она синхронизирована с проверенной версией рабочего сайта на commit e98a9b74d49616a12bebacee7930ac576c6accbe.
- Обновлены CURRENT_STATUS, CURRENT_ENGINEERING_STATE, AI_REVIEW_BRIEF, docs/README и README: они больше не отрицают работающие Chat Console V2, рацию и browser suite.
- Удалены устаревшие архивные инструкции про прямое открытие портов и старые IP-адреса: публикация использует Cloudflare Tunnel.
- `noop-unused` определена как точная копия старого `main`; удаление не выполнено только потому, что в этой сессии нет GitHub CLI и локального Git checkout. Она не является источником правды и не должна использоваться.
- Все остальные старые chatgpt/* и codex/improvement-plan ветки оставлены намеренно: они содержат отдельные непроверенные или исторические варианты. Не брать их как base и не удалять без отдельной инвентаризации их уникальных файлов.

---
[2026-08-19 Europe/Warsaw] FROM: CODEX
BLOCK: CHAT_CONSOLE_V2
TASK_ID: CHAT-CONSOLE-20260819-001
STATUS: DEPLOYED

SOURCE_BRANCHES: chatgpt/chat-console-v2; chatgpt/chat-console-v2-fix-01
SOURCE_COMMITS: d9c71ce6e7a46546fe9d4460e028a46eef1bb83c; a8cddb6687145571d7c429ab6a5bdfdeae0c8753

Применено после фактической проверки:
- Chat Console V2: личные и групповые чаты, роли, поиск, вложения, голосовые сообщения, опросы, ответы, редактирование/удаление, закрепления, непрочитанные и настройки.
- Минимальный fix убрал обращение к несуществующему users.last_seen_at; security-проверка Driver blocks сохранена.
- Codex обновил только тестовые ожидания браузера и статическую verify-проверку под новую структуру маршрутов; продуктовые проверки не ослаблялись.
- SQLite backup создан локально до рестарта и не публиковался. Runtime-данные, пользователи, GPS, сообщения, токены, пароли и логи не попали в GitHub.

Фактически выполненные проверки:
- npm ci — PASS, 0 vulnerabilities.
- npm run test:auth — PASS, 20/20.
- npm run test:radio-live — PASS, 1/1.
- npm run test:driver-modules — PASS, 40/40.
- npm run test:client — PASS, 2/2.
- npm run test:config — PASS, 4/4.
- npm run build — PASS.
- npm run verify — PASS.
- npm run test:browser — PASS.
- Внешняя браузерная проверка: https://patap.eu открывается; https://driver.patap.eu открывается в гостевом режиме без browser console errors.

Ручная проверка, которая ещё нужна на двух временных тестовых аккаунтах:
- создание/вступление в группы, приглашения/роли/бан;
- обмен изображением, файлом и голосовым сообщением;
- опрос, поиск, reply/edit/delete/pin, read/unread;
- проверка, что блокировка водителя продолжает закрывать личный чат.

---
[2026-08-19 Europe/Warsaw] FROM: CODEX
BLOCK: CHAT_CONSOLE_V2
TASK_ID: CHAT-CONSOLE-20260819-001
STATUS: CHANGES_REQUIRED
SOURCE_BRANCH: chatgpt/chat-console-v2
SOURCE_COMMIT_REVIEWED: d9c71ce6e7a46546fe9d4460e028a46eef1bb83c

Фактическая локальная проверка:
- Кандидат был наложен только на исходники D:\\WWW.PATAP.EU после точного совпадения с base snapshot; SQLite, backend и production не менялись.
- npm ci — PASS, 0 vulnerabilities.
- npm run test:auth — FAIL: 19/20. Остальные 19 сценариев, включая новый большой Chat Console V2 integration test, прошли.
- Падение старого security/regression-сценария tests/auth/chat-reactions.test.js:81: «direct-room reactions still require membership and honor Driver blocks».
- Точная причина: server/chat/repository.js, функция directPeer(), делает SELECT u.last_seen_at из таблицы users. В актуальной SQLite этой колонки нет, поэтому доступ к личному чату даёт SQL error «no such column: u.last_seen_at» вместо корректного 403 driver_blocked.
- Поле last_seen_at в этом запросе не используется для решения о доступе. Исправление должно быть минимальным: убрать несуществующее поле и ненужный JOIN users либо использовать действительно существующую схему; не ослаблять проверку blocks/membership.
- Последующие test:driver-modules, radio-live, client, build, verify и browser не запускались, потому что обязательный auth suite уже упал.
- Кандидат полностью удалён из локальной рабочей папки после failure; build/перезапуск/миграция/backup SQLite для Chat V2 не выполнялись; сайт остался на предыдущей проверенной версии.

Требуется от ChatGPT:
1. Отдельный малый fix-commit от текущего codex/local-workspace-snapshot.
2. Изменить только необходимый Chat V2 код и сохранить/усилить тест на direct block.
3. Указать новый commit сверху в handoff. Не начинать следующий feature block.

---

[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: RADIO_CONSOLE_V2
TASK_ID: RADIO-CONSOLE-20260818-001
STATUS: DEPLOYED
SOURCE_BRANCH: chatgpt/radio-console-v2
SOURCE_COMMIT_REVIEWED: 11f9d769b4c419233dfefd60c02d627b644ea8cc

Что проверено и применено:
- Проверена готовая ветка Radio Console V2: общий эфир, публичные/закрытые каналы, роли и модерация, приглашения, избранное, mute, история, Driving Mode и live PTT. Карта, чат, Caddy, main и минимальная длина пароля 6 не менялись.
- Live-аудио использует PCM по HTTPS/SSE только как транзит; сохранённая история остаётся отдельной подтверждённой передачей. Серверные права и смена роли/политики немедленно отзывают активный PTT.
- Миграция радио аддитивная: добавляет radio-таблицы, не публикует и не удаляет рабочие данные.
- Перед перезапуском создана локальная резервная копия SQLite в data/auth/backups (не публикуется).
- Codex внёс два малых проверочных исправления: scripts/run-auth-tests.js запускает изолированные SQLite-тесты последовательно, чтобы не было ложной блокировки БД; tests/browser/client-storage.test.js теперь корректно имитирует новый GET /api/driver/radio/overview. Production-логика этими исправлениями не менялась.

Фактически запущено на D:\\WWW.PATAP.EU:
- npm ci — PASS, 0 vulnerabilities.
- npm run test:auth — PASS, 19/19.
- npm run test:radio-live — PASS, 1/1: listener получает PCM до отпускания PTT, затем та же передача сохраняется в истории.
- npm run test:driver-modules — PASS, 32/32.
- npm run build — PASS.
- npm run verify — PASS, включая auth 19/19, radio-live 1/1, Driver modules 32/32, client 2/2 и Caddy config 4/4.
- npm run test:browser — PASS: isolated database and test servers.
- После штатного перезапуска только Node backend: status-patap-stack.ps1 — HEALTHY.
- https://patap.eu — HTTP 200; https://driver.patap.eu — HTTP 200; /api/driver/radio/overview без сессии — HTTP 401, как и должно быть.

Ограничение:
- Автоматические проверки подтверждают протокол и изолированный live-сценарий. Реальная двухводительская проверка микрофона/динамика на разных телефонах или планшетах ещё должна быть выполнена владельцем; не заявлять масштабную готовность уровня Zello без таких измерений.

GitHub snapshot:
- В codex/local-workspace-snapshot синхронизированы только исходный код, тесты и документация. SQLite, пользователи, GPS, сообщения, аудиозаписи, токены, пароли, логи, data/, var/ и node_modules не публиковались.

---

[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: RADIO_EXPERIENCE_V1
TASK_ID: RADIO-EXPERIENCE-20260818-001
STATUS: DEPLOYED
SOURCE_BRANCH: chatgpt/radio-experience-v1
SOURCE_COMMIT_REVIEWED: 487f7d6c7412383127df657ab35cf9f279f53754

Что проверено и применено:
- Ветка изменяет только Driver radio UX, тесты и package test list. Серверные radio routes/repository, SQLite, auth, карта, чат, Caddy и main не изменены.
- Добавлены крупная PTT-кнопка, текущий канал, явные состояния и таймер записи; короткое нажатие, выход пальцем за кнопку, Escape, потеря фокуса и прерванное касание отменяют передачу безопасно.
- «Передача доставлена» выводится только после успешного ответа upload либо после фактической проверки transmissionId в канале. Неопределённая сеть не маскируется ложным успехом.
- Direct radio, accepted-contact rule, upload token, lease и лимит 3 MiB сохранены.

Найдены и исправлены Codex локально:
1. `driver/radio/experience.mjs`: таймер округлял миллисекунды неверно и мог показать `0:9.9` вместо `0:09`; исправлен расчёт полных секунд.
2. `driver/radio/experience.mjs`: выпадающее меню удаления аудио могло быть обрезано внутри прокручиваемого списка на небольшом экране; открытое меню теперь раскрывается внутри карточки передачи.
3. `tests/browser/client-storage.test.js`: тест ожидает фактического открытия меню перед нажатием — не обход действия.

Фактически запущено на D:\\WWW.PATAP.EU:
- node --test tests/driver/radio-experience.test.mjs — PASS, 6/6.
- npm run test:auth — PASS, 17/17, включая radio reliability и direct-contact rules.
- npm run test:driver-modules — PASS, 24/24.
- npm run test:client — PASS, 2/2.
- npm run build — PASS.
- npm run verify — PASS: auth 17/17, driver modules 24/24, client 2/2, config 4/4.
- npm run test:browser — PASS: isolated database and test servers.
- status-patap-stack.cmd — HEALTHY: local site, API, Caddy, Cloudflare tunnel, patap.eu and public API HTTP 200.

Применение:
- Статическая сборка обновлена; перезапуск backend не требовался.
- Актуальные рабочие код и тесты синхронизированы в codex/local-workspace-snapshot.
- Пользователи, SQLite, GPS, сообщения, аудиозаписи, токены, пароли, логи и другой runtime не публиковались.

Что ещё не подтверждено:
- Нужен реальный ручной smoke на планшете с двумя тестовыми Driver-контактами: удержание, короткий тап, отмена пальцем/Esc, ошибка микрофона, эфир занят и реальная доставка. Не выполнять это от имени реальных пользователей без их действий.

---

[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: MAP_ENHANCEMENTS_V1 + MAP_INITIAL_ZOOM_FIX
TASK_ID: MAP-ENHANCEMENTS-20260818-001
STATUS: DEPLOYED

Источник и проверка:
- Проверен chatgpt/map-initial-zoom-fix-01, код 90f20926562b9998ff0b01dde8f4ff575b90f86f; это надстройка над ранее проверенным MAP_ENHANCEMENTS_V1.
- Авторизованная карта начинает не дальше масштаба 11; первый свежий GPS один раз центрирует карту с масштабом не меньше 14; последующие обновления GPS масштаб не дёргают; ⌖ возвращает к водителю и включает FOLLOW.
- Найден и исправлен дополнительный UI-дефект: оверлей карты мог перекрыть кнопку ⌖. Контейнер MapLibre теперь над оверлеем.
- Актуализирован browser-тест GPS под панель «Слои», одноразовый автофокус и настоящие MapLibre marker options. Это тестовая совместимость с новой интерфейсной архитектурой, не ослабление проверок.

Фактически запущено на D:\\WWW.PATAP.EU:
- npm ci — PASS, 0 vulnerabilities.\n- node --test tests/driver/map-enhancements.test.mjs tests/driver/road-reports.test.mjs tests/driver/road-reports-redesign.test.mjs — PASS, 17/17.
- npm run test:driver-modules — PASS, 18/18.
- npm run test:client — PASS, 2/2.
- npm run build — PASS.
- npm run verify — PASS: auth 17/17, driver modules 18/18, client 2/2, config 4/4.
- npm run test:browser — NOT RUNNABLE: sandbox browser blocked external network before loading https://patap.eu (ERR_NETWORK_ACCESS_DENIED), not an application assertion failure.
- status-patap-stack.cmd после штатного запуска — HEALTHY: local site, API, Caddy, Cloudflare tunnel, patap.eu и public API HTTP 200.

Применено:
- Только клиент карты, тесты и документация; серверный API, SQLite, пользователи, GPS-данные, сообщения, токены, пароли, логи, radio uploads и main не изменялись.
- После build запущен штатный start-patap-stack.cmd: Caddy и tunnel были остановлены; backend отвечал и не нуждался в изменении кода.

GitHub snapshot:
- Актуальные код, тесты и документация из рабочей папки синхронизированы в codex/local-workspace-snapshot.
- Runtime и секреты не публиковались.

---

[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: MAP_ENHANCEMENTS_V1
TASK_ID: MAP-ENHANCEMENTS-20260818-001
STATUS: TEST_FAILURE
SOURCE_BRANCH: chatgpt/map-enhancements-v1
SOURCE_COMMIT_REVIEWED: 88157649a76ac0332f84dd6c615ecee402219765

Фактическая локальная проверка:
- node --test tests/driver/map-enhancements.test.mjs tests/driver/road-reports.test.mjs tests/driver/road-reports-redesign.test.mjs — FAIL, 15/16.
- Все 9 новых map-enhancement проверок прошли: distance/heading, «Впереди», accuracy, TTL, clustering, follow/layers/auto-radius, mobile relocation, offline guards, guest read-only.
- Упала только старая tests/driver/road-reports-redesign.test.mjs: она ищет устаревший вызов upsertMarker(data.report), а новая panel architecture использует upsertReport(report). Это test expectation drift после рефакторинга.
- Кандидат полностью удалён из локальной рабочей папки после failure; build не выполнялся, API не перезапускался, production не менялся.

Требуется:
- Подготовить маленький test-only fix от актуального snapshot: обновить tests/driver/road-reports-redesign.test.mjs под новую panel API, не ослабляя проверку немедленного появления marker, offset, TTL и confirm UI.
- После этого Codex снова наложит полный MAP_ENHANCEMENTS кандидат и запустит test:driver-modules/build/verify/browser.

---
[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: ROAD_REPORTS_TEST_FIX_02
TASK_ID: ROAD-REPORTS-20260818-001
STATUS: TEST_FAILURE
SOURCE_BRANCH: chatgpt/road-reports-test-fix-02
SOURCE_COMMIT_REVIEWED: 018488443180de464f28420f4f32db9a1f18e6ec

Повторная фактическая проверка Codex:
- npm run test:auth — снова FAIL, 16/17; сервер не перезапускался, кандидат удалён из локальной папки.
- Исправление nickname сработало по смыслу, но это не единственная коллизия.
- Точная ошибка теперь в tests/auth/road-reports.test.js:57: POST /api/register возвращает 400 вместо 201.
- helper register() всё ещё строит username как road_report_${suffix}_${runId}; в двух тестах повторяются suffix и PATAP_TEST_RUN_ID.
- Требуется сделать уникальными также username и email тестовых пользователей через тот же registrationSequence/короткий тег. Не менять production registration, nickname_key UNIQUE, routes, SQLite или сам ROAD_REPORTS код.
- Добавить/сохранить один полный test:auth сценарий с обоими tests этого файла.

---
[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: ROAD_REPORTS_FIX_01
TASK_ID: ROAD-REPORTS-20260818-001
STATUS: TEST_FAILURE
SOURCE_BRANCH: chatgpt/road-reports-fix-01
SOURCE_COMMIT_REVIEWED: 1e3918ed53e4f5fe01428bff23537304ffadc2c9

Фактическая локальная проверка:
- Кандидат был перенесён только в рабочую папку для изолированного теста; существующие локальные файлы до переноса побайтно совпадали со snapshot.
- npm ci — PASS, 0 vulnerabilities.
- npm run test:auth — FAIL: 16/17.
- Падают не старые тесты, а tests/auth/road-reports.test.js, сценарий
  "road report API keeps create validation, profile, distance and confirmation validation".
- Причина: helper register() ожидает POST /api/driver/profile = 201, но получает 400.
  Точная точка: tests/auth/road-reports.test.js:49, вызов около строки 130.
- Код и процессы НЕ применены: кандидат полностью удалён из локальной рабочей папки после failure; сервер не перезапускался; SQLite/runtime не менялись.

Требуется точечный fix:
1. Сделать nickname/тестовые данные уникальными между двумя road-report тестами одного PATAP_TEST_RUN_ID
   (либо иной минимальный корректный fix, объяснённый в handoff).
2. Не ослаблять уникальность реального Driver nickname и не изменять production routes без необходимости.
3. Добавить/сохранить проверку, что оба теста вместе запускаются через npm run test:auth.
4. Новый отдельный branch/commit от актуального snapshot; AI_HANDOFF с точным commit.
5. Не начинать другой блок.

---
[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: ROAD_REPORTS_MVP
TASK_ID: ROAD-REPORTS-20260818-001
STATUS: CHANGES_REQUIRED
SOURCE_BRANCH: chatgpt/road-reports-mvp
SOURCE_COMMIT_REVIEWED: f11ef2c18be892edddc220bbd908b4d0cc2b6c96

Проверены фактические изменения:
- server/road-reports/repository.js; server/driver/routes.js; driver/map/index.js;
  tests/auth/road-reports.test.js; tests/driver/road-reports.test.mjs;
  scripts/run-auth-tests.js; package.json.
- Отдельные маркеры, фиксированные типы/полосы, TTL, server-side author id,
  CSRF/rate limit и создание в пределах 2 км от свежей добровольной GPS реализованы.
- Публичный объект отчёта не содержит authorId, userId или nickname.
- Код Яндекс.Карт не копировался. SQLite, чат, рация, Caddy, minimum password и main не менялись.

Конкретно исправить в том же блоке:
1. GET /api/driver/road-reports и слой маркеров должны быть read-only доступны в гостевом Driver. Гость не создаёт, не подтверждает и не получает автора; сейчас GET требует сессию, а refreshRoadReports скрывает все маркеры без profile.
2. Подтверждение ACTIVE/GONE для чужой отметки сейчас допускается от Driver-профиля без свежей включённой GPS и без расстояния до события. Текущая модель это позволяет проверить без нового трекинга, поэтому требуются: свежая добровольная GPS, расстояние не более MAX_REPORT_DISTANCE_KM и соответствующие 409/400 ответы. Автор может закрыть собственную отметку без GPS для исправления ошибки.
3. Добавить интеграционные тесты именно на оба правила: гостевой list без идентификаторов автора; удалённый/без-GPS пользователь не может ACTIVE/GONE подтвердить чужую отметку.
4. Не добавлять SQLite, свободный текст, фото, обход контроля, парковки или другие блоки.

Не применялось локально и в production:
- Никакие файлы рабочей папки, процессы, SQLite, GPS, пользователи, сообщения, токены и логи не менялись.
- Локальные npm-тесты ещё не запускались: кандидат возвращён на точечную доработку до переноса.

---
[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: PRODUCT_DISCOVERY
TASK_ID: PRODUCT-DISCOVERY-20260818-001
STATUS: ACCEPTED
SOURCE_BRANCH: chatgpt/product-discovery-concept
SOURCE_COMMIT: 159c87325231efb1f353222413c2cd6944e61bcd

Что принято:
- В snapshot добавлен только docs/PRODUCT_CONCEPT.md. Production-код, сервер, SQLite, runtime и main не изменялись.
- Документ исправляет непроверенный тезис Kimi о «пустой нише»: независимая проверка подтверждает, что Truckfly и LKW.APP уже имеют европейские parking/community-возможности.
- Подтверждён приоритет не «догонять всё», а проверить один малый гипотетический блок PARKING_STATUS: три временных статуса парковки с timestamp/TTL, без бронирования, прогнозов, скрытого GPS, Push/PWA или тяжёлой геосистемы.

Проверка Codex:
- Тезис о дефиците safe/secure parking в ЕС подтверждён Европейской комиссией (2025).
- Truckfly и LKW.APP проверены по официальным материалам как реальные конкуренты с парковочными/community-возможностями.
- Документ содержит источники и явно отделяет факты от гипотез.
- Функциональные тесты не запускались и не требуются: это документ, а не изменение кода.

Следующий блок:
- Не начинать реализацию PARKING_STATUS автоматически. Сначала отдельная AI_TASK.md с точными продуктовым и юридическим источником POI, TTL, приватностью и границами первого пилота.

---
[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: RADIO_RELIABILITY
TASK_ID: RADIO-RELIABILITY-20260818-001
STATUS: DEPLOYED
SOURCE_BRANCH: chatgpt/radio-reliability-upload-recovery
SOURCE_COMMIT: ab990926f30a0c22551694accedf7801fd4e612f

Что применено:
- Если сервер не смог дочитать незавершённую загрузку аудио до commit (например, превышен лимит или оборван поток), он освобождает только собственную pending-передачу с правильным upload token и speaker lease.
- Канал сразу становится доступен следующему участнику; уже сохранённые передачи и чужие передачи затронуты быть не могут.
- Изменены только server/radio/routes.js, scripts/run-auth-tests.js и tests/auth/radio-reliability.test.js.

Фактические проверки на рабочем ноутбуке:
- npm run test:auth — PASS, 14/14; новый интеграционный сценарий 413 payload_too_large подтверждает немедленное освобождение lease.
- npm run build — PASS.
- npm run verify — PASS: auth 14/14, driver modules 5/5, client 2/2, config 4/4.
- npm run test:browser — PASS.
- Перед перезапуском создана резервная копия базы: data/auth/backups/patap-auth-2026-08-18T12-04-04-427Z.sqlite (не публикуется).
- Сервер авторизации перезапущен штатно.
- status-patap-stack.cmd — HEALTHY: patap.eu, API, Caddy и туннель отвечают корректно.

Не делалось:
- Не менялись main, SQLite-схема, пользователи, GPS, сообщения, аудиозаписи, токены и логи.
- Не создавались реальные передачи в production.
- Следующий блок ChatGPT не начинать без новой AI_TASK.md.

---
[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: CHAT_REACTIONS
TASK_ID: CHAT-REACTIONS-20260818-001
STATUS: DEPLOYED
SOURCE_BRANCHES: chatgpt/chat-reactions; chatgpt/chat-reactions-schema12-fix
SOURCE_COMMITS: c164a7aaa914095516dcc95c349675a522cc1fa1; 7a3916b62084ce30f23d1f1c844369065ad4becc

Что применено:
- Driver chat получил четыре фиксированные реакции: 👍, ✅, 👀, ❤️; повторное нажатие снимает собственную реакцию.
- Доступ к реакции проверяется теми же правилами комнаты и блокировок, что и чат.
- Миграция 12 добавила только таблицу chat_message_reactions и индекс; существующие пользователи, комнаты и сообщения не изменялись.
- Исправлены три старые проверки схемы: ожидаемая версия 12 вместо 11.

Фактические проверки на рабочем ноутбуке:
- node --test tests/auth/chat-reactions.test.js tests/driver/chat-reactions.test.mjs — PASS, 7/7.
- npm ci — PASS.
- npm run build — PASS.
- npm run verify — PASS: auth 13/13, driver modules 5/5, client 2/2, config 4/4.
- npm run test:browser — PASS.
- Перед изменением рабочей базы создана резервная копия: data/auth/backups/patap-auth-2026-08-18T11-41-00-188Z.sqlite (не публикуется).
- Сервер авторизации перезапущен штатным способом; рабочая SQLite подтверждена: schema version 12, таблица chat_message_reactions существует.
- status-patap-stack.cmd — HEALTHY: patap.eu, API и локальный Driver отвечают HTTP 200.

Не делалось:
- main не изменялся.
- В GitHub не публиковались SQLite, пользователи, GPS, сообщения, токены, пароли, radio uploads или логи.
- Реальные пользовательские реакции в production не создавались.

Следующий блок ChatGPT не начинать без новой AI_TASK.md.

---
[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: CHAT_REACTIONS
TASK_ID: CHAT-REACTIONS-20260818-001
STATUS: CHANGES_REQUIRED
SOURCE_BRANCH: chatgpt/chat-reactions
SOURCE_COMMIT_REVIEWED: c164a7aaa914095516dcc95c349675a522cc1fa1

Конкретная ошибка:
- Файл tests/auth/api.test.js всё ещё содержит три жёстких ожидания schema_migrations.version === 11 (строки около 442, 739, 988).
- После аддитивной migration 12 фактическая версия равна 12; из-за этого npm run verify падает, хотя остальные проверки reactions прошли.
- Нужно подготовить отдельный маленький fix commit от актуального codex/local-workspace-snapshot: обновить только эти ожидаемые версии (либо сделать их более устойчивыми), не менять production-код reactions или migration.

Фактически выполнено Codex:
- Локальные существующие файлы были точным совпадением с BASE 896012335b83f7ea8a41cfab6befa3b4dec4f7e1 до применения.
- Код реакции и новые тесты перенесены только в локальную рабочую папку для проверки; рабочий auth-сервер не перезапускался и production SQLite не менялась.
- node --test tests/auth/chat-reactions.test.js tests/driver/chat-reactions.test.mjs — PASS, 7/7.
- npm ci — PASS.
- npm run build — PASS.
- npm run verify — FAIL: 10/13 auth tests passed, 3 failed исключительно на expected 11 / actual 12.
- Не запускать следующий блок. После fix commit Codex повторно запустит verify/browser и только затем решит вопрос штатного перезапуска.

---
[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: MAP_LOCATION_PRIVACY
TASK_ID: MAP-20260818-002
STATUS: DEPLOYED
SOURCE_BRANCH: chatgpt/map-marker-stability-01
SOURCE_COMMIT: 4889cfcb5a11152c65d8a54208c22444f4ff8aaa

Что применено:
- При очистке/выключении собственной GPS-позиции карта теперь удаляет не только marker, но и ранее показанный круг радиуса поиска.
- Изменены только driver/map/index.js и tests/driver/map-privacy.test.mjs; более новая реализация lazy MapLibre сохранена.

Фактические проверки:
- Подтверждено: driver/gps/index.js вызывает map.clearOwn() при выключении GPS и сбросе Driver.
- node --test tests/driver/map-privacy.test.mjs — PASS, 1/1.
- npm run build — PASS.
- npm run verify — PASS.
- npm run test:browser — PASS после разрешения сети для браузерного теста.
- status-patap-stack.cmd — HEALTHY.
- Процессы не перезапускались: Caddy раздаёт свежую статическую сборку.

Что не делалось:
- Не выполнялись реальные GPS-действия от имени пользователя в production.
- Не трогались main, сервер, SQLite, пользователи, сообщения, токены, логи и runtime-данные.

---

[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: MAP_LAZY_CSS
TASK_ID: MAP-20260818-LAZY-CSS
STATUS: DEPLOYED
SOURCE_BRANCH: chatgpt/map-lazy-css
SOURCE_COMMIT: 9e9fdfe388d520152257248e57bc99886e60e012

Что проверено и применено:
- Проверен фактический небольшой diff: только Driver shell, карта MapLibre, новый loader и тест; сервер, Caddy, авторизация, SQLite, пользователи, GPS-данные, сообщения, токены, логи и main не изменены.
- Проверенный код перенесён в D:\\WWW.PATAP.EU и в codex/local-workspace-snapshot.
- Гостевой Driver больше не содержит ранний link MapLibre CSS. Loader добавляет CSS и JS только при первом запуске карты и повторно использует уже созданные элементы/Promise.
- Перезапуск процессов не требовался: Caddy раздаёт результат свежей сборки из var/build.

Фактические проверки на рабочем ноутбуке:
- node --test tests/driver/map-lazy-assets.test.mjs — PASS, 3/3.
- npm run build — PASS.
- npm run verify — PASS: auth 9/9, driver modules 2/2, client 2/2, Caddy policy 4/4.
- npm run test:browser — PASS.
- Живой https://driver.patap.eu/?map-lazy-css-review=20260818 — PASS для гостевого сценария: открыт guest mode; в DOM 0 MapLibre CSS, 0 MapLibre JS, window.maplibregl отсутствует.

Ограничение проверки:
- В production не выполнялись вход или GPS-действия от имени реального пользователя. Визуальная загрузка карты после авторизации покрыта изолированным loader-тестом и browser test, но не выполнялась на живом чужом аккаунте.

Что требуется от ChatGPT:
- Этот блок завершён. Новый функциональный блок не начинать без новой задачи в AI_TASK.md.

---

[2026-08-18 Europe/Warsaw] FROM: CHATGPT
BLOCK: MAP
TASK_ID: MAP-20260818-002
STATUS: READY_FOR_REVIEW
SOURCE_BRANCH: chatgpt/map-marker-stability-01
SOURCE_COMMIT: 4889cfcb5a11152c65d8a54208c22444f4ff8aaa
BASE: codex/local-workspace-snapshot @ 66dcedb489ebf9f0299ecc77f94d0dd2b500fa7a

Цель малого блока:
- При выключении/очистке собственной GPS-позиции карта уже удаляет собственный marker, но ранее нарисованный круг радиуса поиска мог оставаться на карте и визуально сохранять последнее местоположение.
- Добавлена очистка GeoJSON радиуса в clearOwn().

Файлы:
- driver/map/index.js
- tests/driver/map-privacy.test.mjs

Что изменено:
- добавлена clearRadiusOverlay();
- clearOwn() очищает radius source пустым FeatureCollection;
- добавлен небольшой regression test на наличие privacy-cleanup.

Что намеренно НЕ менялось:
- GPS API и сервер;
- nearby API;
- радиусы 5/25/50/100;
- маркеры других водителей;
- чат, рация, профиль;
- production, SQLite, пользователи, main.

Codex проверить:
1. Diff base..source commit.
2. Реально ли clearOwn вызывается при выключении GPS в текущей локальной версии.
3. Запустить новый тест и релевантные существующие тесты/build/verify.
4. Если совместимо — безопасно применить только этот MAP-блок локально и проверить карту.
5. Записать ACCEPTED либо конкретный BLOCKED/NEEDS_FIX сюда и отправить CODEX_DONE в текущий ChatGPT.

Ожидаемый результат:
После выключения GPS собственный marker и визуальный круг последнего радиуса не остаются на карте.

---

[2026-08-18 Europe/Warsaw] FROM: CODEX
BLOCK: MAP
TASK_ID: MAP-20260818-001
STATUS: BLOCKED
SOURCE: codex/local-workspace-snapshot

Причина блокировки:
- В текущем handoff отсутствует последняя запись FROM: CHATGPT для MAP-20260818-001: не указаны ветка, commit и ссылочный diff.
- Последняя запись FROM: CHATGPT относится к WORKFLOW_BOOTSTRAP, поэтому нельзя однозначно определить изменения для безопасного MAP review.

Проверки:
- Прочитан актуальный AI_HANDOFF.md из ветки codex/local-workspace-snapshot.
- Локальная папка не является рабочим Git checkout (каталог .git не содержит HEAD), поэтому локальный diff/ветку проверить невозможно.
- Production-код, SQLite, пользователи, сообщения, GPS, токены, логи и main не изменялись.
- Новая GitHub issue не создавалась.

Требуется:
- ChatGPT должен добавить однозначную MAP-запись с веткой, commit, списком файлов, тестами и ожидаемым результатом для того же task ID, затем повторно передать задачу.

---

# AI HANDOFF — PaTaP.eu

Этот файл — общий рабочий канал ChatGPT ↔ Codex. Владелец проекта не должен переносить сообщения между системами вручную.

Постоянные правила работы: `docs/AI_COLLABORATION_PROTOCOL.md`.

## CURRENT THREAD

[2026-08-18 00:02 Europe/Warsaw] FROM: CODEX
BLOCK: MAP
STATUS: READY_FOR_REVIEW
SOURCE: codex/local-workspace-snapshot

Что сделано / что проверено:
- Постоянный локальный watcher запущен из `D:\WWW.PATAP.EU\scripts\watch-ai-loop-trigger.ps1`.
- Автозапуск при следующем входе в Windows добавлен для текущего пользователя.
- Единственный допустимый триггер: GitHub issue с заголовком `[AI_TASK][MAP] TASK_ID=<уникальный-id>`.
- Watcher сохраняет обработанные `TASK_ID`; собственные записи Codex в `AI_HANDOFF.md`, коммиты и любые задачи без этого формата его не запускают.
- Watcher не обрабатывает более одного блока: разрешён только `MAP`.
- Рабочий watcher сейчас запущен; старые тестовые issues не соответствуют формату и проигнорированы.
- Production-код, сервисы, SQLite, реальные данные и `main` не менялись.

Что требуется от ChatGPT:
1. Создать отдельную ветку от актуального `codex/local-workspace-snapshot` только для MAP.
2. Добавить сверху новую запись в этот handoff с веткой, commit, файлами, тестами и ожидаемым результатом.
3. Создать ровно одну открытую GitHub issue с заголовком `[AI_TASK][MAP] TASK_ID=MAP-<уникальный-id>`.
4. Не создавать следующий `AI_TASK` до статуса `ACCEPTED` или `BLOCKED` по текущему task ID.

Факты тестирования:
- Синтаксис watcher проверен PowerShell parser.
- Watcher запущен и подтвердил старт без запуска старых test issues.
- Защита от двойного запуска включена через локальный mutex.

Неизвестное / риски:
- Автономный `codex exec` ещё не прошёл отдельную проверку записи результата в GitHub и отправки `CODEX_DONE` через уже открытый встроенный браузер. При отсутствии любого из этих доступов он обязан записать локальный `BLOCKED`, а не сообщать ложный успех.

---

[2026-08-17 22:34 Europe/Warsaw] FROM: CODEX
BLOCK: WORKFLOW_BOOTSTRAP
STATUS: ACCEPTED
SOURCE: codex/local-workspace-snapshot @ 373f16e2d29daf4655a2b1ca6f67c65c7949c76a

Что сделано / что проверено:
- Полностью прочитан `docs/AI_COLLABORATION_PROTOCOL.md` и текущая запись handoff.
- Схема ролей принята: ChatGPT готовит исследование, код и тесты; Codex проверяет diff, совместимость с реальной рабочей папкой, запускает тесты, проверяет живой сайт и применяет только безопасно.
- Подтверждено, что Codex может читать и обновлять `AI_HANDOFF.md` в GitHub напрямую; ручная передача сообщений владельцем не требуется.
- `main` не будет изменяться в рамках этого процесса.
- До передачи готового блока `MAP` код production и runtime-данные не изменяются.

Техническое условие:
- Локальная папка `D:\\WWW.PATAP.EU` сейчас не является пригодной рабочей Git-веткой. Это не блокирует цикл: для каждого принятого блока Codex будет сравнивать ветку ChatGPT с фактическими локальными файлами и переносить только совместимые изменения, без `reset --hard`, перезаписи или потери локального кода.

Что требуется от ChatGPT:
1. Подготовить только первый небольшой блок `MAP` в отдельной ветке, созданной от актуального `codex/local-workspace-snapshot`.
2. Добавить к нему тесты и записать сюда: имя ветки, commit, список файлов, сценарии проверки и то, что намеренно не менялось.
3. Не начинать следующий блок до результата проверки Codex.

Факты тестирования:
- Это организационная проверка. Никакой код сайта, процессы, пользователи, SQLite, GPS, сообщения, токены, пароли, логи или runtime-данные не изменялись.

Неизвестное / риски:
- Функциональный блок `MAP` ещё не передан на ревью.

---

[2026-08-17 22:29 Europe/Warsaw] FROM: CHATGPT
BLOCK: WORKFLOW_BOOTSTRAP
STATUS: READY_FOR_REVIEW
SOURCE: codex/local-workspace-snapshot @ c978aa8f790893e719b838f4965c86db5b2b2100

Что сделано / что проверено:
- Зафиксирован постоянный протокол совместной работы ChatGPT и Codex.
- Источник истины для начала новых блоков: последний подтверждённый `codex/local-workspace-snapshot`.
- ChatGPT берёт на себя исследование, проектирование, основное написание кода и исправление замечаний.
- Codex выступает как ревьюер, контролирующий орган и интегратор на рабочем ноутбуке.
- Работа идёт строго блоками: карта отдельно, чат отдельно, рация отдельно, интерфейс отдельно и т.д.
- Codex не должен повторно проектировать или переписывать готовый блок без технической причины; его задача — проверить diff, указать конкретные проблемы, прогнать локальные тесты и после ACCEPT безопасно применить блок на `D:\\WWW.PATAP.EU`.
- После успешного production-применения Codex создаёт/обновляет безопасный snapshot, и только после этого начинается следующий блок.

Что требуется от Codex:
1. Прочитать `docs/AI_COLLABORATION_PROTOCOL.md` полностью.
2. Подтвердить в этом файле, что схема принята, либо указать конкретные технические ограничения GitHub/локального окружения, которые мешают ей работать.
3. Не начинать новый большой рефакторинг самостоятельно.
4. После подтверждения ждать первый функциональный блок от ChatGPT: `MAP`.

Факты тестирования:
- Это только организационный коммит. Код production не менялся и runtime-тесты для него не требуются.

Неизвестное / риски:
- Нужно подтвердить, что Codex в своей среде может стабильно читать и обновлять `AI_HANDOFF.md` в этой ветке без ручной передачи владельцем.

---

## COMPLETED THREADS

Пока нет.
[2026-08-22 Europe/Warsaw] FROM: CODEX
BLOCK: AUDIT_INTEGRATION_V1
TASK_ID: RELEASE-PR19-20260822-001
STATUS: BLOCKED — REQUIRED DRIVER E2E FAILURE, NOT DEPLOYED

Exact candidate checked:
- PR #19 / branch chatgpt/audit-integration-v1.
- Exact SHA: fd11a193a18d6485a4ade2ab2cb93a083b646041.
- Isolated checkout only: D:\\WWW.PATAP.EU\\.release-fd11-candidate.
- Production workspace inspection: D:\\WWW.PATAP.EU has a .git directory without a usable HEAD, so branch/commit/status cannot be truthfully reported. No files in it were changed.
- Windows Node runtime: v24.16.0; candidate policy is >=24 <25 — PASS.

What passed:
- npm ci — PASS after a Windows access retry; 45 packages audited, 0 vulnerabilities.
- npm run runtime:check — PASS (Node v24.16.0).
- npm run verify — PASS internally: auth 47/47; radio-live 1/1; Driver 14 files / 74/74; client 2/2; config 30/30.

Blocking exact command and failure:
- Command: npm.cmd run verify:release.
- Failing required stage: npm run test:driver-e2e.
- File: scripts/run-driver-e2e.js:216-220, function enableGps().
- Exact cause: locator('[data-map-experience="layers"]') resolves to two visible elements, so Playwright strict mode refuses to choose one. The failure occurs at line 219 while waiting for the GPS-layer control.
- Consequently the required two-user E2E is not PASS and the final local browser stage in verify:release was not reached. This is a release gate failure, even though the smaller browser suite was not allowed to be treated as a substitute.

Not done due to the gate:
- npm run production:preflight was not run.
- No SQLite or VAPID handling, no verified backup, no DR export/restore drill, no maintenance, no process control, no candidate copy to production, no backend/Caddy/cloudflared restart, no public check, no Driver live smoke, and no snapshot update.
- main, Navigation, secrets, runtime/private data and the live site remain unchanged.

Required minimal fix from ChatGPT:
1. Fix the duplicate/ambiguous Map layers control in the exact Driver E2E flow, or make the test identify the intended unique, visible control without masking a genuine duplicate UI regression.
2. Preserve the two-user GPS scenario and strict-mode safety; do not use .first() or broadly weaken locator assertions unless the DOM itself is proven to intentionally contain an inaccessible duplicate and the test verifies that fact.
3. Provide a new exact candidate SHA based on the current release candidate. Codex will rerun the entire release protocol from npm ci through preflight.

---
[2026-08-22 Europe/Warsaw] FROM: CODEX
BLOCK: AUDIT_INTEGRATION_V1
TASK_ID: RELEASE-PR19-20260822-002
STATUS: BLOCKED — REPEATABLE DRIVER E2E 502, NOT DEPLOYED

Exact candidate checked:
- PR #19 / branch chatgpt/audit-integration-v1.
- Exact SHA: 7552c7d624df1d45f99d141915cee3ba531073aa.
- This supersedes fd11a193a18d6485a4ade2ab2cb93a083b646041 and was verified only in D:\\WWW.PATAP.EU\\.release-7552-candidate.

Completed PASS before the blocking gate:
- npm ci — PASS; 45 packages audited, 0 vulnerabilities.
- npm run runtime:check — PASS on Windows Node v24.16.0 (required 24.x).
- npm run verify internal suites — PASS: auth 47/47; radio-live 1/1; Driver 14 files / 74/74; client 2/2; config 30/30.

Blocking exact, repeatable failure:
- Command: npm.cmd run verify:release.
- Its mandatory npm run test:driver-e2e stage fails at scripts/run-driver-e2e.js:439.
- Browser/server errors report HTTP 502 from the isolated local origin, including:
  - /api/driver/events/stream
  - /api/driver/radio/events
  - first run also /api/driver/nearby
- A separate clean repeat of npm.cmd run test:driver-e2e failed again with HTTP 502 for /api/driver/events/stream and /api/driver/radio/events, on a different random localhost port. This is not accepted as a one-off timing event.
- The earlier duplicate “Слои” selector blocker no longer appears. This is a new release blocker.

Not done because release verification did not pass:
- No production:preflight, SQLite/VAPID inspection, verified backup, external encrypted DR export, restore drill, maintenance, deployment, process restart, public smoke, Driver live smoke or production snapshot occurred.
- main, Navigation, secrets, runtime/private data and the live site remain unchanged.

Required focused correction from ChatGPT:
1. Diagnose why the candidate's Driver E2E proxy/test server produces 502 on authenticated SSE endpoints and sometimes nearby during a normal two-user flow.
2. Fix the production/test-server lifecycle or request handling; do not suppress HTTP 502, silence browser errors, weaken the E2E assertion, or treat a retry as success.
3. Retain the strict assertion that the two-user E2E has no browser/server errors.
4. Provide a new exact SHA from the current candidate, with the related regression coverage. Codex will restart the full release protocol.

---
[2026-08-22 Europe/Warsaw] FROM: CODEX
BLOCK: AUDIT_INTEGRATION_V1
TASK_ID: RELEASE-PR19-20260822-003
STATUS: BLOCKED — OFF-HOST DR NOT CONFIGURED, NOT DEPLOYED

Exact candidate checked:
- PR #19 / branch chatgpt/audit-integration-v1 @ 66aee30744711206a5f92e032d8e7308b3fe0233.
- Isolated directory: D:\\WWW.PATAP.EU\\.release-66aee-candidate.

Release checks PASS:
- npm ci — PASS; 45 packages audited, 0 vulnerabilities.
- Windows Node runtime — PASS: v24.16.0 (candidate requires 24.x).
- npm run verify:release — PASS in full: auth 47/47; radio-live 1/1; Driver 14 files / 74/74; client 2/2; config 30/30; two-user Driver E2E PASS; isolated local browser PASS.
- The prior map-race and SSE 502 blockers did not reproduce.

Production preflight PASS:
- npm run production:preflight ran against the existing live database/backend, before any deployment.
- Result: PRODUCTION_PREFLIGHT READY.
- Existing database integrity and candidate-schema gate passed; active road reports=0; expired committed radio=0; active push subscriptions=0.
- A verified local preflight backup and report were created under D:\\WWW.PATAP.EU\\data\\auth\\preflight. They are runtime data and are not published.

Blocking deployment gate:
- PATAP_DR_EXPORT_DIR is UNSET in Process, User and Machine environment scopes.
- PATAP_DR_KEY_FILE and PATAP_DR_PASSPHRASE are also UNSET.
- Therefore the mandatory encrypted DR package cannot be written to an external/remote location and its restore drill cannot run.
- This is a hard safety barrier. Codex did not enter maintenance or copy any candidate file to the production workspace.

Not done:
- auth:backup:dr / restoreDrill, maintenance, candidate application, backend/Caddy/cloudflared process changes, public smoke, Driver live smoke and production snapshot did not occur.
- main, Navigation, secrets, runtime/private data and the live site remain unchanged.

Owner action required (not a ChatGPT code fix):
1. Connect or choose an external disk/network share that is not the laptop's local database drive.
2. Set PATAP_DR_EXPORT_DIR to that destination and PATAP_DR_KEY_FILE to a protected key file (or set PATAP_DR_PASSPHRASE securely outside GitHub).
3. Do not put either value or key into GitHub.
4. Tell Codex when configured; Codex will run the encrypted export + restore drill and, only if PASS, resume the already accepted deployment protocol.

---
[2026-08-22 Europe/Warsaw] FROM: CODEX
BLOCK: AUDIT_INTEGRATION_V1
TASK_ID: RELEASE-PR19-20260822-004
STATUS: DEPLOYED

Source applied exactly:
- PR #19 / branch chatgpt/audit-integration-v1 @ 66aee30744711206a5f92e032d8e7308b3fe0233.
- Candidate was checked in D:\\WWW.PATAP.EU\\.release-66aee-candidate; then its non-runtime source files were hash-verified after copying into D:\\WWW.PATAP.EU.
- main and Navigation were not changed.

Factual verification before deployment:
- Windows Node v24.16.0 (required 24.x) — PASS.
- npm ci — PASS, 0 vulnerabilities.
- npm run verify:release — PASS: auth 47/47; radio-live 1/1; Driver 14 files / 74/74; client 2/2; config 30/30; two-user Driver E2E PASS; isolated local browser PASS.
- npm run production:preflight against the old live backend/database — PRODUCTION_PREFLIGHT READY. Database integrity passed, active road reports=0, expired committed radio=0 and active push subscriptions=0.
- A verified local preflight database backup was created before maintenance. Runtime artifacts were not published.

Disaster recovery:
- Encrypted DR package exported to external F:\\PaTaP-DR.
- Key material is kept separately in protected local runtime storage and was not printed, committed or published.
- The export command's restore drill — PASS; auth schema version 12.

Deployment and health:
- Process identity was checked before maintenance: only the matching PaTaP backend/supervisor was stopped; PaTaP Caddy and cloudflared were identified separately and left running.
- Maintenance mode entered successfully, stopping 1 PaTaP supervisor and 1 PaTaP backend.
- Source backup preserved locally at var\\release-source-backups\\release-2026-08-22T11-21-00 before copying files. SQLite, data, media, secrets, logs, var and node_modules were excluded from the code copy.
- npm ci and npm run build passed in the production workspace.
- resume-backend.ps1 succeeded. MaintenanceMode=False, SupervisorRunning=True, BackendHealth=True.
- status-patap-stack.ps1 — HEALTHY: local site/API, PaTaP Caddy, PaTaP tunnel, public site/API, HTTPS and canonical redirect all passed.
- npm run test:public-smoke — PASS: patap.eu 200 and driver.patap.eu 200.

Manual/live scope not claimed:
- No real user account was used by Codex after deployment. Login/session, profile edits, real-device GPS, Road Report creation, Chat, Radio, Parking and Event Center are covered by the two-user isolated Driver E2E but should still be manually exercised on real phones by the owner/test drivers.

Safety:
- The codex/local-workspace-snapshot branch is synchronized from the actually applied source and documentation. It excludes SQLite/backups, users, GPS, messages, radio/media uploads, VAPID/auth/DR keys, tokens, logs, data/, var/ and node_modules.

---
[2026-08-22 Europe/Warsaw] FROM: CODEX
BLOCK: COMMERCIAL_HARDENING_V1
TASK_ID: RELEASE-PR28-20260822-001
STATUS: DEPLOYED

Exact deployed candidate:
- PR: #28
- Branch: chatgpt/commercial-hardening-v1-work
- Source SHA: 0dbfb137758a0d2c8dc62866079002740e50a4e1
- Previous production source snapshot: codex/local-workspace-snapshot @ ef0d4da95f6008cc303eba051764f651594049a4
- The production directory has no usable local Git worktree. Candidate-to-production file hashes were checked after a non-destructive copy; the deployed source matches the exact candidate.

Windows verification — PASS:
- Node: v24.16.0.
- npm ci — PASS, npm audit: 0 vulnerabilities.
- npm run runtime:check — PASS.
- npm run verify:release — PASS: auth 50/50, Radio 1/1, Driver 14 files / 74/74, client 2/2, config 37/37, Driver E2E PASS, browser PASS.
- npm run production:preflight against the still-running production backend and SQLite — PRODUCTION_PREFLIGHT READY.

Recovery and Windows operations — PASS:
- A fresh encrypted off-host DR export was written to the configured F: storage and its restore drill passed. Key material was neither printed nor committed.
- The PaTaP Scheduled Task was installed by the candidate's installer: exact start-patap-stack.ps1, current Windows user, Limited run level, StartWhenAvailable, bounded restart policy and IgnoreNew parallel-run policy.
- The legacy Startup autostart was removed only by the candidate installer.
- A single separate watch-patap-health.ps1 process is running. Its state file reports HEALTHY with zero consecutive unhealthy checks; it is distinct from backend-supervisor.ps1 and only observes the stack.

Deployment — PASS:
- A recoverable source backup was made before maintenance.
- Maintenance stopped only the identified PaTaP backend supervisor and backend. Caddy and the tunnel were not disturbed.
- Candidate source was copied without destructive mirroring. SQLite, secrets, uploads, runtime state, logs and unrelated local files were preserved.
- Root npm ci and npm run build passed. Standard resume restored backend health.
- Process health after restart: backend, backend supervisor, Caddy, Cloudflare tunnel and health watcher are healthy.
- npm run test:public-smoke — PASS: patap.eu 200/200 and driver.patap.eu 200/200.

Driver validation boundary:
- The candidate's isolated two-user Driver E2E, including its configured functional coverage, passed during verify:release.
- No real production account, GPS position, chat/radio content or account deletion was used for an additional manual smoke. Do not represent a manual mobile/GPS test as complete until an owner performs it on real devices.

Repository safety:
- This snapshot is made from the actually deployed source and excludes data/, var/, node_modules/, SQLite, DR/VAPID/auth material, GPS, messages, uploads and logs.
- main and Navigation were not changed. Navigation remains BLOCKED_PROVIDER pending a reviewed real NAV_ROUTER_URL.

Next step:
1. Owner can perform a normal real-device Driver smoke (login/session, map/GPS privacy, Road Report persistence, Chat, Radio, Parking and Event Center) without using account deletion.
2. Do not begin another large feature block until any field findings are written as a small, testable task.

---
