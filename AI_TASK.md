# AI_TASK — AUD-021 AUTH_ASYNC_SCRYPT_V1: deployed

Status: `DEPLOYED` after full local Windows verification and production checks.

Источник production до этого блока: `codex/local-workspace-snapshot`.
Рабочая ветка: `chatgpt/aud-021-auth-async-scrypt-v1`.
Draft PR: #30.
База ветки: `a75b19210f935610c259d88f54ed1525d62f3201` (тот же production source snapshot плюс документы нового чата; production-code parent описан в `docs/AI_NEW_CHAT_START.md`).

## Цель

Закрыть `AUD-021 — AUTH_ASYNC_SCRYPT_V1`: убрать синхронный scrypt из HTTP request path авторизации, не меняя парольную политику и формат существующих хэшей.

## Сделано

- `server/auth/password.js` использует callback-based `crypto.scrypt()` через Promise.
- Формат сохранён: `scrypt$v=1$N=32768$r=8$p=1$...`; старые хэши должны проверяться без миграции.
- Обычная и Driver-регистрация вычисляют хэш до SQLite write transaction.
- Login после async-verify перечитывает пользователя и атомарно обновляет счётчик неудачных входов, чтобы асинхронность не ослабила lockout.
- Password reset после вычисления хэша повторно проверяет одноразовый token внутри короткой `BEGIN IMMEDIATE` transaction перед сменой пароля и отзывом сессий.
- Защищённое удаление аккаунта использует async password verify и отклоняет операцию, если password hash изменился во время проверки.
- Добавлен `tests/auth/password-async.test.js`; он запрещает использование `scryptSync` новым KDF, проверяет новый формат, неверный пароль и совместимость с legacy hash.
- Тест включён в штатный `npm run test:auth` runner.

## Не менялось

- минимальная длина пароля остаётся **6 символов**;
- scrypt cost parameters не менялись;
- auth schema остаётся 12;
- `main`, Navigation, Caddy, runtime/private data, SQLite production, пользователи и secrets не менялись.

## Фактическая проверка Codex

- Точный SHA `8b3e39b9cacde87fbd6bcee5cf91df3e2d1a6ee8` проверен в изолированной Windows-копии.
- `npm ci`, `runtime:check` и полный `verify:release` — PASS: audit 0, auth 51/51, Radio 1/1, Driver 74/74, client 2/2, config 37/37, двухпользовательский Driver E2E и browser PASS.
- Production preflight — READY. Свежая зашифрованная внешняя DR-копия и restore drill — PASS.
- Код скопирован без удаления SQLite, секретов, media и runtime. Root build, backend resume, stack health и public smoke двух доменов — PASS.
- Реальный пользовательский аккаунт, GPS и удаление аккаунта после установки не использовались.

Следующий audit-code block не начинать без отдельного маленького задания от актуального `codex/local-workspace-snapshot`.
