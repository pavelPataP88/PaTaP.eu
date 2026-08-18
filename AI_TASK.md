# AI_TASK — ROAD_REPORTS_TEST_FIX_02

Исправить только падение локального теста из верхней записи `ROAD_REPORTS_FIX_01 / TEST_FAILURE` в `AI_HANDOFF.md`.

Факт Codex: `npm ci` прошёл; `npm run test:auth` упал 16/17. В `tests/auth/road-reports.test.js` helper `register()` повторно создаёт Driver nickname в двух тестах одного `PATAP_TEST_RUN_ID`, и ожидаемые 201 превращаются в 400.

Нужно:
1. Подготовить отдельную ветку от актуального `codex/local-workspace-snapshot`.
2. Сделать тестовые nickname уникальными между тестами, не ослабляя уникальность реальных Driver nickname.
3. Не менять поведение дорожных отметок, маршруты, SQLite, Caddy, чат, рацию, пароль минимум 6 или main без технической необходимости.
4. Указать в `AI_HANDOFF.md` branch, точный commit, изменённые файлы и что полный `npm run test:auth` в среде ChatGPT не заявляется как PASS.
5. После commit остановиться: Codex снова применит кандидат временно и реально запустит весь набор тестов.
