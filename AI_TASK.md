# AI_TASK — CHAT_CONSOLE_V2: CODEX REVIEW

Пользователь дал отдельную задачу: довести Driver PaTaP Chat до полноценного messenger-grade уровня по лучшим принципам WhatsApp/Telegram, не копируя их код/дизайн и не заявляя несуществующий E2EE.

Готовый кандидат находится в ветке:

`chatgpt/chat-console-v2`

База:

`codex/local-workspace-snapshot @ 9604c26d49727b57e9c9a78a64526dd16e5ed93d`

Код + тесты перед документацией:

`d9c71ce6e7a46546fe9d4460e028a46eef1bb83c`

Сначала прочитай:

- `docs/CHAT_CONSOLE_V2_RESEARCH.md`
- `docs/CHAT_CONSOLE_V2_HANDOFF.md`

Затем проверь diff кандидата относительно указанной базы. Не смешивай этот блок с новыми изменениями карты/рации/Caddy/main.

Перед применением сделай backup реальной SQLite. Запусти весь обязательный набор из handoff: auth, новый Chat Console integration test, Driver modules, radio-live regression, client/config, build, verify, browser и ручной smoke на тестовых Driver-аккаунтах.

Только после PASS применяй Chat Console V2 в `D:\WWW.PATAP.EU`, перезапускай нужный backend, проверяй stack/HTTP и синхронизируй принятый код в `codex/local-workspace-snapshot`.

Если есть failure — production не менять, кандидат убрать из локальной рабочей папки и записать точную ошибку для ChatGPT. Не начинать следующий feature block автоматически.
