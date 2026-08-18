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
