[2026-08-18 Europe/Warsaw] FROM: CHATGPT
BLOCK: CHAT_REACTIONS
TASK_ID: CHAT-REACTIONS-20260818-001
STATUS: READY_FOR_REVIEW
SOURCE_BRANCH: chatgpt/chat-reactions-schema12-fix
SOURCE_COMMIT: 7a3916b62084ce30f23d1f1c844369065ad4becc
BASE: codex/local-workspace-snapshot @ 0b12c0f0b22b3557e77599aac02eafda78085905

Что исправлено:
- Изменён только `tests/auth/api.test.js`.
- Три существующие проверки `schema_migrations.version === 11` обновлены на текущую версию схемы `12`.
- Production-код reactions, migration 12, карта, рация, Caddy, парольные правила и другие блоки не менялись.
- Итоговый diff `BASE..SOURCE_COMMIT`: ровно 3 добавления / 3 удаления в одном файле, только `11 -> 12`.

Фактические проверки:
- GitHub compare `codex/local-workspace-snapshot...chatgpt/chat-reactions-schema12-fix` подтверждает scope: changed file только `tests/auth/api.test.js`, три изменения `11 -> 12`.
- Полный `npm run verify` в среде ChatGPT НЕ ЗАПУСКАЛСЯ: доступного локального checkout репозитория в этой среде нет. Это не считается пройденным тестом.
- Предыдущая фактическая проверка Codex до fix: `npm run verify` дала 10/13 auth PASS и 3 FAIL исключительно `expected 11 / actual 12`; Codex должен повторно запустить verify после применения этого fix.

Codex проверить:
1. Diff `0b12c0f0b22b3557e77599aac02eafda78085905..7a3916b62084ce30f23d1f1c844369065ad4becc`.
2. Повторно запустить `npm run verify` и при необходимости browser test в реальном checkout.
3. Применить только этот маленький fix, если проверки проходят.
4. Следующий блок ChatGPT не начинал.

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
- Проверенный код перенесён в D:\WWW.PATAP.EU и в codex/local-workspace-snapshot.
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
- Локальная папка `D:\WWW.PATAP.EU` сейчас не является пригодной рабочей Git-веткой. Это не блокирует цикл: для каждого принятого блока Codex будет сравнивать ветку ChatGPT с фактическими локальными файлами и переносить только совместимые изменения, без `reset --hard`, перезаписи или потери локального кода.

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
- Codex не должен повторно проектировать или переписывать готовый блок без технической причины; его задача — проверить diff, указать конкретные проблемы, прогнать локальные тесты и после ACCEPT безопасно применить блок на `D:\WWW.PATAP.EU`.
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
