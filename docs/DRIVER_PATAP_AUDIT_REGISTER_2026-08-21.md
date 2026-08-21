# DRIVER PATAP — AUDIT / REPAIR REGISTER

Дата: 2026-08-21 Europe/Warsaw  
Статус: **INFORMATIONAL — NO CODE CHANGES / NOT DEPLOYED**  
Репозиторий: `pavelPataP88/PaTaP.eu`  
Проверенная база аудита: `codex/local-workspace-snapshot @ 2ccf14c1ac6f58829d3222988ccd74457f5c8bef`  
Ветка этого документа: `chatgpt/audit-register-20260821`

## 0. Назначение файла

Это не одна большая задача и не разрешение автоматически переписывать проект.

Это постоянный реестр найденных дефектов, рисков и технического долга Driver Patap. Исправлять его нужно **маленькими независимыми блоками**, по одному блоку за цикл ChatGPT → Codex → test → deploy → новый snapshot.

Для каждого блока ниже указаны:
- статус факта;
- приоритет;
- конкретные места в репозитории;
- проблема;
- минимальный безопасный объём исправления;
- критерий, по которому можно доказать, что блок действительно исправлен.

### Приоритеты

- **P0** — риск неправильного поведения/потери целостности ключевых дорожных данных или существенная privacy-проблема. Исправлять до расширения аудитории.
- **P1** — серьёзная надёжность, security, release или storage-проблема. Исправлять в ближайших технических циклах.
- **P2** — важный технический долг/масштабирование/совместимость. Не блокирует текущий маленький пилот, но не оставлять надолго.
- **P3** — архитектурная чистка. Делать только после функциональных и эксплуатационных проблем.
- **OWNER DECISION** — технически обнаружено, но изменение продуктового правила требует решения владельца.

### Правило выполнения

Нельзя брать весь этот файл одной задачей. Для каждого пункта создаётся отдельный блок. Если два пункта тесно связаны и один нельзя безопасно исправить без второго, это прямо указано.

---

# A. Целостность данных и долговечность

## AUD-001 — ROAD_REPORTS_PERSISTENCE_V1

**Приоритет:** P0  
**Статус:** CONFIRMED DEFECT

### Факт

`server/driver/routes.js` создаёт дорожное хранилище через `createRoadReportStore()`.

`server/road-reports/repository.js` хранит дорожные события в:

```js
const reports = new Map();
let nextId = 1;
```

События, голоса и счётчик ID существуют только в памяти процесса Node.

### Что ломается

После любого restart backend:
- активные ДТП исчезают;
- дорожные работы исчезают;
- препятствия исчезают;
- road control / transport inspection исчезают;
- подтверждения водителей исчезают;
- `nextId` снова начинается с `1`.

При этом Event Center хранит события в SQLite и может продолжать содержать ссылку на старый `reportId`. После restart эта ссылка становится мёртвой, а в будущем тот же числовой ID может быть выдан уже другому дорожному событию.

### Что исправить

Сделать долговечный домен Road Reports в SQLite, минимум:
- `road_reports`;
- `road_report_votes`;
- стабильный autoincrement ID;
- `created_at`, `expires_at`, `closed_at`;
- TTL/prune через SQL;
- уникальный голос пользователя на report;
- закрытие автором или требуемым количеством `GONE`;
- Event Center должен ссылаться на стабильный DB report.

Лучше сделать событие Event Center через durable outbox/trigger после commit Road Report, а не через отдельный in-memory вызов.

### Не делать в этом блоке

- новый дизайн карты;
- новые типы дорожных событий;
- репутацию пользователей;
- AI-анализ;
- внешние дорожные API.

### Проверка

Обязательный интеграционный тест:
1. временная DB;
2. создать ДТП;
3. подтвердить вторым пользователем;
4. остановить backend;
5. запустить backend с той же DB;
6. событие и голос существуют;
7. Event Center открывает именно тот же report;
8. истёкший report удаляется/закрывается по политике TTL;
9. ID не переиспользуется для другого живого события.

---

## AUD-002 — RADIO_RETENTION_CLEANUP_V1

**Приоритет:** P1  
**Статус:** CONFIRMED DEFECT

### Факт

`server/radio/repository.js` задаёт:

```js
const TRANSMISSION_RETENTION_DAYS = 30;
```

Committed transmission получает `expires_at`, и API перестаёт показывать его после истечения.

Но код очищает только просроченные `UPLOADING` записи. Автоматического удаления просроченных `COMMITTED` записей и соответствующих файлов из `data/radio` не найдено.

### Риск

Снаружи передача выглядит удалённой через 30 дней, но:
- строка остаётся в SQLite;
- аудиофайл остаётся на диске;
- объём базы и `data/radio` растёт бессрочно;
- pinned/служебные ссылки также могут оставаться до каскадной очистки.

### Что исправить

Отдельный retention-cleaner:
- найти `COMMITTED AND expires_at <= now`;
- получить `storage_key`;
- безопасно удалить файл;
- удалить DB row в согласованном порядке;
- обработать отсутствующий файл без падения;
- логировать количество очищенных записей/байтов;
- запускать ограниченными batch, не на каждый пользовательский запрос.

### Проверка

Тест с коротким тестовым TTL:
- committed audio существует;
- после expiry cleaner удаляет файл и DB row;
- active audio не удаляется;
- повторный cleanup идемпотентен;
- отсутствие файла не ломает cleanup.

---

## AUD-003 — AUTH_MIGRATION_ATOMICITY_V1

**Приоритет:** P1  
**Статус:** CONFIRMED RISK

### Факт

`server/auth/db.js::migrate()` выполняет глобальные schema migrations последовательными DDL + отдельным `INSERT INTO schema_migrations` без явной транзакции вокруг каждой версии.

Некоторые старые migration DDL используют `CREATE TABLE` / `ALTER TABLE` без полной идемпотентности.

### Риск

Если процесс/диск/питание оборвётся после части DDL, но до записи версии migration, следующий запуск может повторить уже частично выполненную migration и не стартовать.

### Что исправить

Не переписывать историю schema вслепую.

Сделать migration runner для будущих версий:
- `BEGIN IMMEDIATE`;
- выполнить всю migration version N;
- записать version N;
- `COMMIT`;
- при ошибке `ROLLBACK`;
- pre/post schema assertions;
- backup перед production migration остаётся обязательным.

Для уже существующих migration добавить recovery-test на частично выполненную migration в временной DB и определить безопасный repair path.

### Проверка

Fault-injection test:
- искусственно оборвать migration между DDL и version insert;
- повторный запуск не должен безвозвратно ломать DB;
- integrity_check = ok;
- schema version корректна.

---

# B. Privacy, GPS и пользовательские данные

## AUD-004 — GPS_PRIVACY_PRECISION_V1

**Приоритет:** P0/P1  
**Статус:** CONFIRMED PRIVACY RISK

### Факт

`server/people/privacy.js` по умолчанию использует:

```text
nearbyVisibility = EVERYONE
```

`server/driver/location.js::nearbyDrivers()` при разрешении `canSeeNearby()` возвращает фактические `latitude` и `longitude` другого водителя.

То есть стандартная модель сейчас в основном отвечает на вопрос «виден / не виден», но не отделяет приблизительное местоположение от точного.

### Почему исправлять

Для дорожной социальной сети точная координата — значительно более чувствительные данные, чем факт «водитель рядом». Принцип GDPR data minimisation и data protection by default требует выдавать только необходимый объём персональных данных.

### Что исправить

Сделать **серверную** модель точности, не только визуальное размытие:
- `PUBLIC_APPROXIMATE` — округлённая/смещённая зона для обычных nearby;
- `CONTACT_APPROXIMATE` или более точная зона для контактов;
- `TRUSTED_PRECISE` — точная позиция только trusted;
- `NOBODY`;
- временный precise-share конкретному контакту на ограниченный срок как отдельный будущий маленький блок.

Точная исходная координата не должна отправляться клиенту, которому положено только approximate.

### Проверка

Два/три пользователя:
- stranger видит только approximate;
- contact получает только разрешённую точность;
- trusted получает precise только если это явно разрешено политикой;
- blocked не получает ничего;
- GPS OFF удаляет location;
- изменение privacy начинает действовать серверно сразу.

### Исследовательская основа

European Commission GDPR principles: data minimisation, storage limitation, privacy by design/default.

---

## AUD-005 — GPS_RATE_CONTRACT_V1

**Приоритет:** P1/P2  
**Статус:** CONFIRMED DEFECT

### Факт

Клиент `driver/gps/index.js` использует:

```text
SEND_THROTTLE_MS = 10_000
```

Сервер `server/driver/routes.js` разрешает location update примерно один раз в 12 секунд:

```text
checkRate(..., 1, 1 / 12)
```

### Результат

Нормальный клиент периодически сам попадает в `429 location_rate_limited`.

### Что исправить

Один контракт частоты.

Минимально:
- единая server policy, например 15 s;
- клиент не должен отправлять чаще;
- желательно возвращать policy/config с backend, чтобы цифры не дублировались в двух файлах.

### Проверка

5 минут simulated GPS updates без единого 429 при нормальном клиенте; искусственно более частый client всё ещё получает server rate-limit.

---

## AUD-006 — SESSION_TOUCH_THROTTLE_V1

**Приоритет:** P2  
**Статус:** CONFIRMED PERFORMANCE DEBT

### Факт

`server/auth/server.js::getSession()` при каждом успешном чтении session выполняет два UPDATE:
- `sessions.last_seen_at`;
- `users.last_seen_at`.

Этот метод используется большим количеством API и realtime проверок.

### Риск

На SQLite это создаёт лишние write transactions даже для read-heavy/realtime трафика.

### Что исправить

Throttle last-seen write, например не чаще одного раза в 30–60 секунд на session/user, сохраняя корректную семантику admin stats.

Не ослаблять revoke/expiry checks.

### Проверка

Load-test показывает многократное снижение UPDATE last_seen при одинаковом количестве API запросов; значения last_seen остаются достаточно свежими для продукта.

---

## AUD-007 — USER_DATA_CONTROL_V1

**Приоритет:** P2 / COMPLIANCE READINESS  
**Статус:** GAP FOUND

### Факт

В текущем auth API найдены admin disable/enable/session revoke/role/reset-token, но не найден полноценный пользовательский сценарий:
- экспорт своих данных;
- удаление собственного аккаунта;
- понятная серверная очистка связанных runtime media/data.

### Что исправить

Сначала спецификация данных и retention, затем отдельные маленькие блоки:
1. `ACCOUNT_EXPORT_V1` — экспорт профиля/настроек/контактов/собственных материалов без чужих приватных данных.
2. `ACCOUNT_DELETE_V1` — подтверждаемое удаление/анонимизация согласно выбранной политике, включая media cleanup.
3. Privacy/retention notice — отдельный документ/UI, не смешивать с backend delete.

### Ограничение

Это не юридическое заключение. Перед публичным масштабированием правила удаления/сроков хранения должны быть проверены применительно к реальному оператору сервиса в ЕС.

---

# C. Push / Event Center

## AUD-008 — PUSH_EVENT_PAYLOAD_V1

**Приоритет:** P1  
**Статус:** CONFIRMED DESIGN DEFECT

### Факт

`server/events/push.js` отправляет Web Push POST без payload с конкретным event.

`driver/event-worker.js` после `push` делает authenticated fetch `/api/driver/events/overview`, выбирает самый свежий unread event и показывает его.

### Проблемы

1. Две близкие push-доставки могут обе показать один и тот же «latest event», а не конкретные события, которые вызвали push.
2. Push зависит от ещё действующей cookie session. Обычная Driver session создаётся на 12 часов и имеет фиксированный `expires_at`. Если session истекла, service worker получает push, но не сможет забрать `/overview`, значит системное уведомление может не появиться.
3. Push subscription может быть живой дольше auth session, поэтому эта схема не является надёжным background notification transport.

### Что исправить

Перейти на нормальный encrypted Web Push payload, минимум с:
- event id;
- title/category/priority или безопасным generic preview;
- route identifier;
- без чувствительного текста, если пользователь отключил previews.

Использовать стандарт Web Push message encryption (RFC 8291); не писать самодельную криптографию, если достаточно проверенной бесплатной open-source библиотеки.

Service worker должен использовать `PushEvent.data`, а при открытии уже обращаться к API за актуальной полной сущностью.

### Проверка

- две push подряд создают две правильные notification/tag semantics;
- push работает после закрытия вкладки;
- push не требует active page;
- сценарий expired web session определён явно;
- notification click после повторного login открывает правильный event или показывает «событие больше недоступно»;
- previews OFF не утекут в payload/notification.

### Исследовательская основа

- MDN `PushEvent.data`;
- RFC 8291 Message Encryption for Web Push.

---

## AUD-009 — EVENT_OUTBOX_DEADLETTER_VISIBILITY_V1

**Приоритет:** P2  
**Статус:** CONFIRMED OPERABILITY GAP

### Факт

`server/events/dispatcher.js` после 5 неудачных обработок помечает outbox row как processed, оставляя `last_error`. Обработанные строки затем удаляются retention-cleaner примерно через 7 дней.

### Риск

Постоянная ошибка event projection может тихо превратиться в потерянное уведомление и затем исчезнуть из технической истории.

### Что исправить

Не менять основную outbox модель.

Добавить:
- явное `FAILED/DEAD` состояние или отдельный dead-letter marker;
- admin diagnostic count;
- последние ошибки;
- ручной retry только безопасных/idempotent событий;
- retention failed rows дольше обычных processed rows.

### Проверка

Искусственная постоянная ошибка после N попыток видна в admin diagnostics и не исчезает как обычный success.

---

# D. Тесты и доказательство работоспособности

## AUD-010 — DRIVER_E2E_V1

**Приоритет:** P1  
**Статус:** CONFIRMED TEST GAP

### Факт

`scripts/run-browser-test.js` в основном является E2E Patap Lab/Auth:
- public `patap.eu`;
- registration/login/logout/recovery;
- admin visibility;
- Patap Lab mobile/scroll.

Он не проходит полноценный Driver пользовательский путь `driver.patap.eu` с двумя водителями.

### Почему важно

`browser PASS` сейчас нельзя автоматически читать как «Driver прошёл end-to-end».

### Что исправить

Создать отдельный `test:driver-e2e`, минимум два BrowserContext:
- два Driver аккаунта;
- profile;
- GPS stubs/permissions;
- nearby privacy;
- Road Report create/confirm;
- Parking basic scenario;
- direct Chat;
- direct Radio HTTP/history path (реальный microphone остаётся device smoke);
- Event Center;
- mobile 390x844;
- auth loss/relogin;
- backend restart persistence для durable сущностей.

Не смешивать это с Navigation, пока Navigation не deployed.

### Проверка

Отдельный однозначный результат:

```text
Driver E2E PASS
```

с количеством сценариев, который не зависит от Patap Lab test.

---

## AUD-011 — DRIVER_TEST_DISCOVERY_V1

**Приоритет:** P1/P2  
**Статус:** CONFIRMED DEFECT IN TEST RUNNER

### Факт

В `tests/driver/` существуют тесты, которые не перечислены в `package.json` скрипте `test:driver-modules`.

На текущем snapshot среди примеров:
- `map-lazy-assets.test.mjs`;
- `map-privacy.test.mjs`;
- `road-reports-map-ui.test.mjs`;
- `road-reports-redesign.test.mjs`;

Скрипт запускает ручной фиксированный список файлов, поэтому добавленный test может существовать в репозитории, но никогда не запускаться в `verify`.

### Что исправить

Сделать test discovery, который гарантированно запускает все `tests/driver/*.test.mjs`, либо держать централизованный manifest и отдельный тест, доказывающий, что manifest включает каждый файл.

Предпочтительно не зависеть от shell glob, который по-разному работает на Windows/Linux; discovery должен быть Node-based.

### Проверка

Создать временный failing test-файл по паттерну; `npm run test:driver-modules` обязан упасть. Удалить временный файл после теста.

---

## AUD-012 — RELEASE_GATE_V1

**Приоритет:** P1  
**Статус:** CONFIRMED PROCESS GAP

### Факты

`.github/workflows/verify.yml` запускается на:
- push только в `main`;
- pull request.

Реальная работа ведётся в `codex/*` и `chatgpt/*`, при этом процесс может передавать branch Codex без PR.

Кроме того, `npm run verify` сам по себе не включает `test:browser`; browser запускается отдельной командой в GitHub workflow/manual handoff.

### Что исправить

Сделать один кандидатный release gate:
- CI для `chatgpt/**` и `codex/**` или обязательный draft PR для каждого candidate block;
- `verify:release` должен включать все обязательные non-production проверки;
- Driver E2E после появления AUD-010;
- вывод version/commit/test counts в конце.

Не разрешать CI делать production deploy.

### Проверка

Push заведомо failing candidate branch автоматически получает failed check до передачи Codex.

---

## AUD-013 — NODE_RUNTIME_ALIGNMENT_V1

**Приоритет:** P2  
**Статус:** CONFIRMED ENVIRONMENT DRIFT

### Факт

GitHub Actions использует Node 22.

Рабочая инженерная среда проекта использует Node 24.x, а проект опирается на `node:sqlite`.

`package.json` не фиксирует Node `engines` и нет единого runtime contract в самом package metadata.

На 2026-08-21 Node 24 (`Krypton`) — LTS.

### Что исправить

- выбрать `24.x LTS` как единый major для CI/Codex/runtime;
- добавить `engines.node`;
- обновить Actions `setup-node`;
- startup/verify должен печатать и валидировать major;
- patch version обновлять отдельным безопасным maintenance block, не вместе с продуктовой функцией.

### Проверка

CI и laptop показывают один Node major; неверный major получает понятную ошибку до build/test.

---

## AUD-014 — DEPENDENCY_SECURITY_GATE_V1

**Приоритет:** P2  
**Статус:** GAP FOUND

### Факт

Текущий единственный GitHub workflow выполняет build/tests, но отдельного dependency/security check в `.github` не найдено.

### Что исправить

Бесплатный минимальный уровень:
- `npm audit` как отдельный информативный/гейтящий шаг с заранее определённой severity policy;
- Dependabot для npm/GitHub Actions или эквивалент;
- по возможности CodeQL для public repository;
- dependency update никогда не смешивать с функциональным block без необходимости.

### Проверка

Уязвимая тестовая dependency/known advisory отображается отдельным CI результатом, а не теряется внутри обычных unit tests.

---

# E. Production runtime / Windows host

## AUD-015 — WINDOWS_SERVICES_V1

**Приоритет:** P1  
**Статус:** CONFIRMED RELIABILITY GAP

### Факт

Node backend имеет собственный `backend-supervisor.ps1` и перезапускается после падения процесса.

Caddy и cloudflared запускаются через `Start-Process` и не имеют аналогичного постоянного service-manager supervision в репозитории.

### Что исправить

На Windows:
- `cloudflared` как Windows service;
- Caddy как Windows service (`sc.exe` или WinSW по официальной документации);
- backend либо текущий supervisor с auto-start, либо service wrapper — выбрать один механизм;
- документировать startup order и recovery.

### Почему

Cloudflare официально рекомендует service mode для постоянной доступности Tunnel. Caddy также рекомендует service manager для production.

### Проверка

- reboot Windows → все три компонента поднимаются без ручного запуска;
- kill cloudflared → service восстанавливается;
- kill Caddy → восстанавливается;
- kill backend → восстанавливается;
- public health возвращается без ручного входа на ноутбук.

---

## AUD-016 — STACK_PROCESS_DETECTION_V1

**Приоритет:** P1/P2  
**Статус:** CONFIRMED DEFECT

### Факт 1

`start-patap-stack.ps1::Test-PatapTunnel()` сначала ищет конкретный процесс Patap Tunnel, но если не находит, возвращает true при наличии **любого** процесса `cloudflared`:

```powershell
return [bool](Get-Process cloudflared ...)
```

Другой cloudflared может привести к ложному статусу «Patap tunnel running».

### Факт 2

`start-patap-tunnel.ps1` после запуска делает общий `Get-Process cloudflared`, который также не доказывает, что поднялся именно нужный tunnel.

### Факт 3

`start-origin.ps1` содержит fallback на конкретный пользовательский путь Caddy под `C:\Users\Biuro\...`.

### Что исправить

- идентифицировать tunnel по точному command line/config/tunnel UUID;
- после старта проверять именно public/local expected route, а не имя процесса;
- Caddy path: PATH + явная config переменная, без username-specific fallback;
- status script должен различать `process exists`, `local origin healthy`, `public tunnel healthy`.

### Проверка

Запустить чужой dummy cloudflared: status Patap Tunnel обязан оставаться false.

---

## AUD-017 — CONTINUOUS_HEALTH_WATCH_V1

**Приоритет:** P2  
**Статус:** GAP FOUND

### Факт

Startup scripts умеют проверять health при запуске. Backend supervisor следит прежде всего за существованием процесса. Постоянного end-to-end watchdog `backend -> Caddy -> tunnel -> public driver` в текущей схеме не найдено.

### Что исправить

Локальный бесплатный watchdog с редкой частотой, например 1–5 минут:
- localhost backend health;
- localhost Caddy;
- public `driver.patap.eu` lightweight endpoint/page;
- disk free space;
- последний backup age;
- outbox failed count.

Сначала только логирование. Автоматический destructive recovery не добавлять.

### Проверка

Искусственно остановить каждый слой и убедиться, что log/diagnostic различает, какой именно слой сломан.

---

## AUD-018 — BACKUP_DR_V1

**Приоритет:** P1  
**Статус:** CONFIRMED RESILIENCE GAP

### Что уже хорошо

`server/auth/backup-db.js` использует SQLite backup API и проверяет копию через `PRAGMA integrity_check`.

### Проблема

Backup создаётся под тем же `DATA_DIR/backups` на том же production-ноутбуке.

Сбой/кража/поломка диска может уничтожить и primary DB, и локальные backup одновременно.

Также наличие backup ещё не доказывает, что restore workflow действительно работает на текущей schema.

### Что исправить

Без платного API:
- оставить быстрый local backup;
- добавить вторую зашифрованную копию на другом физическом носителе/другом доверенном устройстве;
- не отправлять runtime data в GitHub;
- периодический automated restore-test в temporary path;
- retention policy backup;
- отдельная проверка recovery VAPID/auth secrets, если без них восстановленный сервис потеряет важную функциональность.

### Проверка

Из выбранного backup на чистом temporary path поднимается DB, проходит integrity_check и smoke чтения основных доменов.

---

## AUD-019 — SINGLE_HOST_FAILURE_PLAN_V1

**Приоритет:** P2  
**Статус:** ARCHITECTURAL RISK

### Факт

`docs/CURRENT_ENGINEERING_STATE.md` фиксирует production на Windows laptop. GitHub — engineering mirror, а не runtime.

### Риск

Ноутбук = single point of failure для:
- backend;
- Caddy origin;
- Tunnel;
- SQLite/media;
- будущего navigation router, если его поставить туда же.

### Что исправить

Не покупать инфраструктуру автоматически.

Сначала написать простой disaster/failover runbook:
- что нужно перенести на запасной компьютер;
- какие binaries/config нужны;
- какие secrets не лежат в GitHub;
- как восстановить DB/media;
- как перепривязать Tunnel;
- максимально ручной pilot failover допустим.

Реальный active-active/high-availability пока не нужен.

---

# F. Storage и abuse limits

## AUD-020 — MEDIA_STORAGE_QUOTAS_V1

**Приоритет:** P1/P2  
**Статус:** CONFIRMED RESOURCE RISK

### Факт

Parking photo:
- до 5 MiB;
- rate limit 12 фото / 10 минут на пользователя;
- в текущем route layer не найден общий storage quota пользователя/паркинга/системы.

Chat допускает вложения до 25 MiB по типу. Radio хранит committed audio и отдельно имеет выявленный retention leak AUD-002.

### Риск

Один авторизованный аккаунт или небольшой набор аккаунтов может постепенно заполнить диск, даже не нарушая текущий per-minute rate limit.

### Что исправить

Общий media budget layer:
- per-user daily bytes;
- per-user stored bytes;
- per-domain limits;
- global low-disk guard;
- admin storage stats;
- orphan-file scanner;
- никакого удаления существующих пользовательских файлов без заранее определённой retention policy.

### Проверка

После достижения quota новый upload получает понятный 413/429/507-подобный domain error; существующие файлы остаются целыми.

---

# G. Auth / security hardening

## AUD-021 — AUTH_ASYNC_SCRYPT_V1

**Приоритет:** P1/P2  
**Статус:** CONFIRMED PERFORMANCE/DoS RISK

### Факт

`server/auth/db.js` использует `crypto.scryptSync()` и для hash, и для verify.

Scrypt намеренно CPU/memory-expensive. Sync вариант выполняется в основном JS execution path и блокирует обработку других Node callbacks на время вычисления.

### Что исправить

Перевести hash/verify на async `crypto.scrypt()` либо отдельный worker abstraction.

Сохранять текущий encoded hash format совместимым, если возможно, чтобы не сбрасывать пароли.

### Проверка

Параллельные login attempts не блокируют health/chat/event loop на длительные sync интервалы; существующие password hashes продолжают проверяться.

---

## AUD-022 — PASSWORD_POLICY_V2

**Приоритет:** OWNER DECISION / P2 security  
**Статус:** CONFIRMED POLICY GAP, **DO NOT CHANGE WITHOUT OWNER APPROVAL**

### Факт

Проект осознанно фиксирует minimum password length = 6. Это записано в инженерных правилах.

Актуальный NIST SP 800-63B-4 рекомендует/требует для single-factor password verifier минимум 15 символов и blocklist часто используемых/скомпрометированных паролей; не рекомендует искусственные composition rules.

### Что делать

Не менять сейчас самовольно.

Если владелец примет решение:
- новые passwords/passphrases >= выбранного нового минимума;
- разрешить длинные passphrase и пробелы;
- blocklist распространённых/скомпрометированных значений без отправки пароля внешнему API;
- существующие аккаунты мигрировать мягко, не массовым принудительным reset;
- позже отдельно Passkeys/TOTP.

### Проверка

Только после explicit owner approval должен появиться кодовый block.

---

# H. Карта и внешние инфраструктурные зависимости

## AUD-023 — MAP_TILE_INFRA_V1

**Приоритет:** P2, до масштабирования/offline  
**Статус:** EXTERNAL DEPENDENCY RISK

### Факт

Driver использует MapLibre локально, что хорошо. CSP и map configuration рассчитаны на raster tiles OpenStreetMap (`tile.openstreetmap.org`).

OSMF прямо указывает:
- tile servers работают best-effort без SLA;
- heavy/inappropriate usage может быть заблокирован;
- bulk/offline download запрещён;
- для offline/масштаба следует использовать другой provider или self-hosted tiles.

### Что исправить

Не ломать текущую карту в пилоте.

Перед масштабом/offline отдельный block:
- configurable tile source;
- self-hosted OSM-derived vector tiles/PMTiles/OpenMapTiles или другой разрешённый источник;
- attribution сохранить;
- offline package только на источнике, который это разрешает;
- tile URL не должен быть навечно hardcoded в UI code.

### Проверка

Отключение public OSM tiles не делает весь Driver архитектурно непереносимым: source переключается конфигурацией; attribution корректна.

---

# I. Radio realtime

## AUD-024 — RADIO_AUDIOWORKLET_V1

**Приоритет:** P2  
**Статус:** CONFIRMED DEPRECATED API

### Факт

`driver/radio/live-audio.mjs` использует `AudioContext.createScriptProcessor()`.

`ScriptProcessorNode` deprecated и заменён `AudioWorklet/AudioWorkletNode`. MDN отдельно указывает, что ScriptProcessor работает на main thread и имеет худшие realtime характеристики.

### Что исправить

Только audio capture/processing transport:
- AudioWorklet processor;
- сохранить текущий 16 kHz PCM network contract на первом этапе;
- fallback определить явно для старого браузера;
- PTT policy/upload token/history semantics не менять.

Не тащить WebRTC/SFU в этот блок.

### Проверка

- Chrome Android + desktop;
- короткий tap gate сохраняется;
- 60 s PTT;
- live fallback to history;
- нет ScriptProcessor use в production path.

---

# J. Navigation

## AUD-025 — NAV_PROVIDER_LOCAL_V1

**Приоритет:** P1 BLOCKER FOR NAVIGATION  
**Статус:** CONFIRMED BLOCKED

### Факт

`AI_TASK.md` фиксирует `BLOCKED_PROVIDER`: `NAV_ROUTER_URL` не настроен, поэтому Navigation candidate не развёрнут.

Кандидат специально не подменяет настоящий truck router fake/leg-car fallback.

### Исследование

Текущий adapter уже написан под Valhalla. Valhalla open-source и официальная документация рекомендует Docker image для локального/собственного HTTP server.

### Что исправить

Отдельный infrastructure block без изменения Navigation business logic:
- поднять self-hosted Valhalla;
- начать с реально нужного региона, а не всей планеты;
- хранить router data вне GitHub;
- задать `NAV_ROUTER_URL` локально;
- проверить TRUCK/VAN/TAXI реальные маршруты и ограничения;
- измерить RAM/disk/build time/query latency.

Публичный demo Valhalla не использовать как production dependency.

### Проверка

Real-provider smoke, не fake fixture:
- truck dimensions меняют/ограничивают маршрут там, где есть соответствующие OSM restrictions;
- no-route остаётся no-route;
- backend provider status = configured;
- restart router восстанавливается по runbook.

---

## AUD-026 — NAVIGATION_REBASE_V1

**Приоритет:** P1 BEFORE NAV DEPLOY  
**Статус:** CONFIRMED BRANCH DIVERGENCE

### Факт на 2026-08-21

Сравнение:

```text
base: codex/local-workspace-snapshot
head: chatgpt/navigation-engine-v1
status: diverged
ahead_by: 75
behind_by: 6
merge base: e78ecbea105c1011a092d67f247b058f5fb2a692
```

То есть Navigation branch уже не является простым продолжением текущего source of truth.

### Что исправить

После AUD-025 и только после появления реального provider:
- создать новый candidate **от самого свежего на тот момент** `codex/local-workspace-snapshot`;
- перенести Navigation domain осознанным diff/cherry-pick/manual integration;
- отдельно разрешить конфликты Map/Parking/Events/People/package tests;
- не force-merge старую ветку поверх snapshot.

### Проверка

Новый Navigation candidate:
- current snapshot является ancestor/base;
- old deployed features regressions PASS;
- navigation tests PASS;
- real Valhalla smoke PASS;
- owner отдельно разрешает apply/restart.

---

# K. Репозиторий, source of truth и архитектурный долг

## AUD-027 — DEFAULT_BRANCH_SOURCE_OF_TRUTH_V1

**Приоритет:** P1/P2  
**Статус:** CONFIRMED REPOSITORY HYGIENE GAP

### Факт

На момент аудита `codex/local-workspace-snapshot` находится **134 commits ahead of `main`**, while `main` is repository default branch.

При этом документация правильно говорит, что реальный engineering source of truth = `codex/local-workspace-snapshot`, а `main` не менять без owner approval.

### Риск

- GitHub по умолчанию показывает устаревший код;
- CI push trigger настроен на `main`, который не является фактическим рабочим snapshot;
- новый AI/человек легко начинает работу не с той базы;
- security/dependency tools могут анализировать default branch, не production mirror.

### Что исправить

Это требует решения владельца о Git policy, но не изменения product code.

Варианты:
1. после controlled review сделать фактический snapshot новой default engineering branch;
2. либо синхронизировать `main` только в специально разрешённый release cycle;
3. либо оставить main неизменным, но изменить default branch на явно названную stable engineering branch.

Нельзя просто merge 134 commits в main без отдельного review/owner approval.

### Проверка

Новый участник открывает репозиторий и без скрытых знаний попадает на документированную актуальную безопасную инженерную базу.

---

## AUD-028 — PLATFORMOS_SCOPE_FREEZE_V1

**Приоритет:** P3  
**Статус:** CONFIRMED ARCHITECTURAL DUPLICATION RISK

### Факт

`system/registry.json` говорит:

```text
activeRuntime = legacy-root-site
```

Future `transport` module = `architecture-only` и disabled, в то время как настоящий Driver активно развивается отдельно.

### Риск

Если одновременно продолжать строить PlatformOS Transport и текущий Driver, появятся две параллельные истины для map/chat/radio/auth/navigation.

### Что исправить

Не удалять PlatformOS.

До стабилизации Driver:
- architecture-only modules заморожены;
- новые Driver fixes делаются в реальном runtime;
- поздняя migration — только по одному domain через explicit strangler plan.

### Проверка

Документация ясно говорит, что `modules/transport` не является runtime implementation Driver и AI не должен туда дублировать текущие fixes.

---

## AUD-029 — SERVER_BOUNDARY_CLEANUP_V1

**Приоритет:** P3  
**Статус:** TECHNICAL DEBT

### Факты

- `server/auth/server.js` одновременно содержит auth/admin HTTP, session handling и WebSocket Chat bootstrap.
- `server/driver/routes.js` создаёт Parking, People и Event runtimes и зависит от порядка domain schema initialization.
- комментарий в коде прямо объясняет, что Parking + People должны инициализировать additive schemas, включая структуры Chat/Radio, до Event Center projection triggers.

### Риск

Не текущая авария, но высокая связность усложняет:
- isolated tests;
- migrations;
- restart lifecycle;
- будущий multi-process split;
- ревью маленьких блоков.

### Что исправить

Только после P0/P1:
- explicit application bootstrap;
- `initSchemas()` в определённом порядке;
- domain services создаются один раз;
- auth server остаётся composition root, а не место бизнес-логики;
- lifecycle `start/stop` для timers/SSE runtimes.

Не делать большой framework rewrite.

---

# L. Дорожные данные и abuse resistance

## AUD-030 — ROAD_REPORT_ABUSE_GUARD_V1

**Приоритет:** P2, после AUD-001  
**Статус:** PRODUCT/ABUSE RISK

### Что уже есть

- report можно создать только рядом со свежей добровольной GPS;
- ограниченная дистанция;
- rate limit;
- TTL;
- peer ACTIVE/GONE confirmation;
- нет свободного текста/фото в базовом road report.

Это хорошая база.

### Чего не хватает перед большой аудиторией

После persistence появится смысл атаковать durable дорожные данные ложными отметками.

Отдельный последующий block:
- report trust score на основе независимых подтверждений, а не количества кликов одного аккаунта;
- repeated false-report abuse counter;
- временное ограничение report creation для явного abuse;
- admin diagnostic/moderation без публикации точной истории передвижений пользователя;
- не превращать это в публичный рейтинг людей.

### Проверка

Один аккаунт не может искусственно создать «высокое доверие» собственному report повторными действиями.

---

# M. Что сейчас НЕ надо «исправлять»

Этот раздел нужен, чтобы будущий AI не превратил аудит в ненужный rewrite.

## НЕ переносить SQLite в Postgres только ради масштаба

На текущем pilot scale SQLite + WAL подходит. Миграция имеет смысл только по измеренному bottleneck/HA requirement.

## НЕ добавлять Kubernetes / микросервисы

Текущая проблема не в отсутствии Kubernetes, а в durability, tests, privacy, service supervision и storage cleanup.

## НЕ переписывать MapLibre

MapLibre — нормальная основа. Проблема — tile infrastructure при масштабе/offline, а не сама библиотека.

## НЕ переписывать Parking Network

Parking domain уже существенно разработан. Следующие шаги — data quality, provider/import operations и интеграция с Navigation после real router.

## НЕ ослаблять CSRF / session cookies / block rules / GPS opt-in

Текущие механизмы являются полезными слоями защиты.

## НЕ разворачивать старую Navigation branch напрямую

Сначала real provider + rebase candidate от свежего snapshot.

## НЕ менять minimum password = 6 без прямого решения владельца

AUD-022 — именно owner decision, а не автоматическое разрешение на изменение.

---

# N. Рекомендуемый порядок ремонтных циклов

Это порядок **не по красоте**, а по риску.

### Wave 1 — целостность и privacy

1. `AUD-001 ROAD_REPORTS_PERSISTENCE_V1`
2. `AUD-004 GPS_PRIVACY_PRECISION_V1`
3. `AUD-002 RADIO_RETENTION_CLEANUP_V1`
4. `AUD-003 AUTH_MIGRATION_ATOMICITY_V1`

### Wave 2 — доказательство и release

5. `AUD-011 DRIVER_TEST_DISCOVERY_V1`
6. `AUD-010 DRIVER_E2E_V1`
7. `AUD-012 RELEASE_GATE_V1`
8. `AUD-013 NODE_RUNTIME_ALIGNMENT_V1`

### Wave 3 — runtime reliability

9. `AUD-016 STACK_PROCESS_DETECTION_V1`
10. `AUD-015 WINDOWS_SERVICES_V1`
11. `AUD-018 BACKUP_DR_V1`
12. `AUD-017 CONTINUOUS_HEALTH_WATCH_V1`
13. `AUD-020 MEDIA_STORAGE_QUOTAS_V1`

### Wave 4 — auth/events/realtime hardening

14. `AUD-008 PUSH_EVENT_PAYLOAD_V1`
15. `AUD-021 AUTH_ASYNC_SCRYPT_V1`
16. `AUD-006 SESSION_TOUCH_THROTTLE_V1`
17. `AUD-009 EVENT_OUTBOX_DEADLETTER_VISIBILITY_V1`
18. `AUD-024 RADIO_AUDIOWORKLET_V1`
19. `AUD-005 GPS_RATE_CONTRACT_V1`

### Wave 5 — Navigation

20. `AUD-025 NAV_PROVIDER_LOCAL_V1`
21. `AUD-026 NAVIGATION_REBASE_V1`

### Wave 6 — product scale / compliance readiness

22. `AUD-023 MAP_TILE_INFRA_V1`
23. `AUD-007 USER_DATA_CONTROL_V1`
24. `AUD-030 ROAD_REPORT_ABUSE_GUARD_V1`
25. `AUD-019 SINGLE_HOST_FAILURE_PLAN_V1`
26. `AUD-014 DEPENDENCY_SECURITY_GATE_V1`

### Wave 7 — repository/architecture cleanup

27. `AUD-027 DEFAULT_BRANCH_SOURCE_OF_TRUTH_V1`
28. `AUD-028 PLATFORMOS_SCOPE_FREEZE_V1`
29. `AUD-029 SERVER_BOUNDARY_CLEANUP_V1`

### Owner-decision track

- `AUD-022 PASSWORD_POLICY_V2`

---

# O. Definition of Done для любого пункта этого реестра

Пункт нельзя отмечать исправленным только потому, что код написан.

Минимум:
1. работа начата от свежего `codex/local-workspace-snapshot`;
2. отдельная candidate branch;
3. diff касается только блока и необходимых тестов/docs;
4. automated regression PASS;
5. новый targeted test действительно доказывает исходный defect;
6. Codex проверил candidate на рабочем ноутбуке;
7. если меняется DB — backup до первого запуска новой schema;
8. owner отдельно разрешил необратимые production действия;
9. applied build + service restart только после PASS;
10. live smoke затронутого сценария;
11. новый safe snapshot;
12. в этом файле статус пункта можно заменить на `FIXED @ <snapshot sha>` только после фактического deployment.

---

# P. Официальные источники повторного исследования — 2026-08-21

Использовать их как engineering basis, а не как замену тестам проекта.

1. OpenStreetMap Foundation — Tile Usage Policy  
   https://operations.osmfoundation.org/policies/tiles/

2. MDN — ScriptProcessorNode (deprecated)  
   https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode

3. MDN — Web Audio API / AudioWorklet  
   https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API  
   https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet

4. NIST SP 800-63B-4 — Password Verifiers  
   https://pages.nist.gov/800-63-4/sp800-63b.html

5. Node.js official release lifecycle — Node 24 Krypton LTS  
   https://nodejs.org/en/about/previous-releases

6. Cloudflare — Run cloudflared as a Windows service  
   https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/

7. Caddy — Keep Caddy Running / Windows service  
   https://caddyserver.com/docs/running

8. European Commission — GDPR principles / data minimisation / privacy by default  
   https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/principles-gdpr/overview-principles/what-data-can-we-process-and-under-which-conditions_en  
   https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en

9. Valhalla official installation — self-host/local server  
   https://valhalla.github.io/valhalla/start/installation/

10. MDN PushEvent.data  
    https://developer.mozilla.org/en-US/docs/Web/API/PushEvent/data

11. RFC 8291 — Message Encryption for Web Push  
    https://www.rfc-editor.org/rfc/rfc8291.html

---

# Q. Audit truth / ограничения

### Что подтверждено непосредственно кодом

Подтверждены, среди прочего:
- in-memory Road Reports;
- Road Report ID reset/reuse risk after restart;
- exact nearby coordinates при разрешённой visibility;
- default nearby visibility `EVERYONE`;
- GPS client/server interval mismatch;
- sync scrypt;
- session last_seen writes на каждый getSession;
- browser runner не является Driver E2E;
- часть Driver test files не включена в test script;
- CI trigger main/PR;
- Node major drift 22 vs 24;
- radio expired committed retention не очищает DB/files автоматически;
- trigger-only Push без event payload;
- process detection cloudflared имеет false-positive path;
- Caddy fallback содержит machine/user-specific path;
- Caddy/cloudflared запускаются не как постоянные Windows services;
- backup остаётся на production host;
- PlatformOS transport не active runtime;
- Navigation provider отсутствует;
- Navigation branch diverged от текущего snapshot.

### Что не проверялось этим документом

- фактическое текущее содержимое production SQLite;
- свободное место production диска;
- реальные Windows service registrations вне репозитория;
- router, который владелец мог установить локально после snapshot, но не записать в GitHub;
- реальные push/browser/device permissions конкретных телефонов;
- юридическая квалификация сервиса по GDPR/национальному праву;
- полный penetration test.

Этот файл не должен использоваться для утверждения, что production сломан по каждому пункту. Он фиксирует конкретные code/repository defects и риски, которые должны быть закрыты или осознанно приняты перед масштабированием Driver Patap.
