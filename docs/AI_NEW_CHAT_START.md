# Новый чат: начни отсюда

Этот документ — короткая актуальная точка входа для нового чата ChatGPT. Восстанавливай состояние проекта по GitHub и последнему production snapshot, а не по старой переписке.

## Где находится правда о проекте

- Рабочий сайт запущен на Windows-ноутбуке владельца. GitHub — безопасное инженерное зеркало, а не production-сервер.
- `codex/local-workspace-snapshot` — evidence-ветка: последний clean snapshot исходников, снятый Codex с реально работающего production после успешного релиза.
- `main` — нормальная stable/default ветка GitHub. Она должна быть синхронизирована с последним проверенным production snapshot только обычным fast-forward, без force/rewrite.
- 22 августа 2026 stale `main` был безопасно fast-forward до production snapshot `0e73e8a1972bfd573b312eb4c87af9ada6d2db0c`; сразу после операции compare был `identical`, ahead 0 / behind 0.
- После каждого нового deployment сначала создаётся и проверяется новый `codex/local-workspace-snapshot`; затем `main` можно fast-forward до него. Если ветки расходятся, остановиться и исследовать, не force-push.
- Перед новой работой всегда читать фактический текущий tip `codex/local-workspace-snapshot` и последнюю запись `AI_HANDOFF.md`; не использовать старый SHA из переписки.

## Что реально установлено

К актуальной production-линии относятся в том числе:

- `AUD-030 ROAD_REPORT_ABUSE_GUARD_V1`;
- `AUD-029 SERVER_BOUNDARY_CLEANUP_V1`;
- `AUD-028 PLATFORMOS_SCOPE_FREEZE_V1`;
- `AUD-025/AUD-026 NAVIGATION_SCOPE_V1`;
- `AUD-024 RADIO_AUDIOWORKLET_V1`;
- `AUD-023 MAP_TILE_PROVIDER_V1`;
- `AUD-021 AUTH_ASYNC_SCRYPT_V1`;
- `AUD-020 MEDIA_STORAGE_QUOTAS_V1`;
- `AUD-019 MACHINE_DISASTER_RECOVERY_V1`;
- `COMMERCIAL_HARDENING_V1`;
- Map/Road Reports, Chat Console V2, Radio Console V2, People & Communities, Parking Network и Event Center.

Точный deployed source, Windows tests, preflight, DR/restore и public-smoke evidence всегда брать из последней записи `AI_HANDOFF.md`.

## Navigation: актуальное решение владельца

Внутренний Navigation Engine **не является требованием Driver V1**.

`AUD-025 NAV_PROVIDER_LOCAL_V1` и `AUD-026 NAVIGATION_REBASE_V1` закрыты/сняты для V1 решением владельца:

- не устанавливать Valhalla;
- `NAV_ROUTER_URL` не является release requirement;
- не подменять truck route обычным passenger-car route;
- историческую `chatgpt/navigation-engine-v1` сохранить, но не merge/rebase/deploy;
- будущий V1 путь — отдельный небольшой external-navigation handoff в выбранное пользователем внешнее приложение.

Подробный контракт: `docs/NAVIGATION_SCOPE_V1.md`.

## Парольная политика

Минимальная длина пароля регистрации для Driver V1 остаётся **6 символов по явному решению владельца**.

- Это осознанный product/security trade-off, а не утверждение, что любой пароль из 6 символов является сильным.
- Не повышать минимум автоматически без нового решения владельца.
- Асинхронный scrypt hashing/verification не ослаблять.
- Не принуждать существующих пользователей к reset/migration без отдельного решения.

Финальная формальная фиксация этой политики относится к `AUD-022 PASSWORD_POLICY_V2`.

## Git/source-of-truth policy

`AUD-027 DEFAULT_BRANCH_SOURCE_OF_TRUTH_V1` закрывается следующим правилом:

1. production snapshot — evidence того, что реально работает;
2. `main` — stable/default GitHub branch;
3. после проверенного snapshot `main` двигается только fast-forward до него;
4. force/rewrite `main` запрещён как обычный способ синхронизации;
5. при divergence сначала расследование;
6. рабочая ветка создаётся от последнего проверенного production source.

## Что не считать готовым

- Встроенной turn-by-turn Navigation PaTaP в production нет и для V1 она намеренно не требуется.
- External-navigation handoff пока отдельная будущая функция и не считается реализованной до отдельного блока и проверки.
- Автоматические E2E не заменяют реальные полевые проверки GPS, микрофона/динамика, Radio/Chat на телефонах; такие проверки отмечать отдельно.
- Закрытие 30-пунктового технического аудита не означает завершение всех будущих продуктовых функций или финального UI/UX redesign.

## Неприкосновенные правила

- Не публиковать и не коммитить `data/`, `var/`, SQLite, пользователей, GPS, сообщения, записи рации, медиа, токены, ключи, пароли, логи или `node_modules/`.
- Не ослаблять CSRF, rate limits, session cookies, Radio access checks или GPS/privacy.
- Один небольшой проверяемый блок за раз: исследование → ветка от актуального production source → код/документы и тесты → PR/handoff → Codex Windows review → deployment только после PASS → clean snapshot → GitHub verification → fast-forward `main`.
- Не добавлять платную инфраструктуру без отдельного решения владельца.
- Не возобновлять Valhalla/internal Navigation только потому, что старые документы называли отсутствие `NAV_ROUTER_URL` блокером: более новое owner scope decision имеет приоритет.

## Что прочитать в таком порядке

1. Этот файл.
2. `AI_TASK.md` — текущий блок.
3. Последнюю запись `AI_HANDOFF.md` — фактический production evidence.
4. `docs/AI_COLLABORATION_PROTOCOL.md`.
5. `docs/CURRENT_ENGINEERING_STATE.md` и нужный тематический документ.

## Первое действие нового ChatGPT

Сначала подтвердить актуальный tip `codex/local-workspace-snapshot`, сравнить его с `main`, прочитать последний `AI_HANDOFF.md` и `AI_TASK.md`. Не начинать rewrite и не менять production вслепую.

## Как передавать работу Codex

После выполнения блока создать отдельную ветку/PR и зафиксировать:

- название блока;
- ветку и точный SHA;
- базовый SHA production snapshot;
- список изменённых файлов;
- что сделано и что намеренно не делалось;
- какие тесты реально запускались и их результат;
- точные шаги Windows/production проверки для Codex;
- риски и всё, что не проверялось.

Никогда не писать `DEPLOYED`, `PASS` или «работает на сайте», если это не подтверждено фактическим Windows/production gate и новым snapshot.
