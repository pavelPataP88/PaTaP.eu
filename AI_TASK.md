# AI_TASK — AUD-021 AUTH_ASYNC_SCRYPT_V1

Status: `READY_FOR_CODEX_REVIEW`, **NOT DEPLOYED**.

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

## Что должен проверить Codex

1. Проверить точный HEAD draft PR #30 и diff только этого блока.
2. В изолированном checkout на Windows выполнить `npm ci` и полный `npm run verify:release`.
3. Отдельно убедиться, что auth/account lifecycle regressions PASS и legacy password hash проходит login.
4. Не считать GitHub CI заменой Windows/production gate.
5. При любом FAIL записать точную причину и не применять блок.
6. При PASS пройти текущие preflight/DR/maintenance/apply/public-smoke правила, не выполняя необратимых действий над реальным аккаунтом.
7. После фактического применения обновить `codex/local-workspace-snapshot` и записать `DEPLOYED` в `AI_HANDOFF.md`.

До `DEPLOYED` следующий audit-code block не начинать.
