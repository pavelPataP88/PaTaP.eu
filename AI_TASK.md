# AI_TASK — PEOPLE_COMMUNITIES_V1: CODEX REVIEW

Пользователь утвердил следующий большой функциональный блок Driver Patap: `Люди / контакты / сообщества` до финальной переработки общего интерфейса.

Готовый кандидат:

`chatgpt/people-communities-v1`

Точная база кандидата:

`codex/local-workspace-snapshot @ d735d21ae9bd5867460f02b0f4a87e82ed280510`

Код + тесты + research до handoff-документа:

`45f25efe7467aa75b98ec39cdfbafc3d44ec186f`

Сначала прочитай:

- `docs/PEOPLE_COMMUNITIES_V1_RESEARCH.md`
- `docs/PEOPLE_COMMUNITIES_V1_HANDOFF.md`
- актуальный `AI_HANDOFF.md`

Основная архитектура: один Community — один авторитетный состав участников + один связанный Chat GROUP + один связанный Radio GROUP. Вступление, приглашения, роли, бан, выход и передача владельца управляются через People и синхронизируются. Не разрешай отдельным Chat/Radio membership-действиям рассинхронизировать Community.

Перед первым запуском backend с кандидатом обязательно сделай локальный backup рабочей SQLite: People добавляет модульную схему/триггеры при старте сервера. Backup и runtime-данные не публиковать.

После проверки diff запусти весь обязательный набор из handoff:

- `npm ci`
- `npm run test:auth`
- `npm run test:radio-live`
- `npm run test:driver-modules`
- `npm run test:client`
- `npm run test:config`
- `npm run build`
- `npm run verify`
- `npm run test:browser`

Затем обязательный smoke на временных Driver-аккаунтах: privacy/search/map visibility, trusted contact, Community create/join/invite, синхронные Chat/Radio роли/бан/выход/owner transfer, точные переходы в связанный чат/радиоканал и `409 community_managed` для попытки отдельно менять linked membership.

ChatGPT не запускал локальные npm-тесты и не заявляет PASS: его контейнер не смог получить ветку по сети. Только фактический прогон на `D:\WWW.PATAP.EU` определяет готовность.

Только после PASS применяй блок, штатно перезапускай Node backend, проверяй stack/public HTTP и синхронизируй принятый код в `codex/local-workspace-snapshot`.

Если есть failure — production не менять, следующий блок не начинать, записать точную ошибку в начало `AI_HANDOFF.md` для ChatGPT.
