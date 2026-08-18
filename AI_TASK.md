# AI_TASK — ROAD_REPORTS_TEST_FIX_03

Исправить только новую точную ошибку из верхней записи `TEST_FAILURE` в `AI_HANDOFF.md`.

В `tests/auth/road-reports.test.js` исправлен nickname, но helper `register()` всё ещё повторяет `username` и `email` в двух тестах одного `PATAP_TEST_RUN_ID`. Локальный `npm run test:auth` падает на строке 57: регистрация возвращает 400 вместо 201.

Нужно в отдельной ветке от актуального `codex/local-workspace-snapshot`:
- генерировать уникальные короткие username и email тестовых пользователей, используя уже добавленный тестовый sequence/tag;
- сохранить реальные правила регистрации, уникальность Driver nickname и весь production-код неизменными;
- изменить только test file и AI_HANDOFF.md;
- после точного commit остановиться. Codex выполнит реальные тесты и только затем применит ROAD_REPORTS.
