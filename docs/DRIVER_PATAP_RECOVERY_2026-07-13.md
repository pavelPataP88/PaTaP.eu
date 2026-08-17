# Driver Patap recovery audit — 2026-07-13

## Recovery addendum after DP-003

- Correctly attributed DeepSeek recovery review and vote were received after the initial audit. Earlier responses signed `FROM=GPT` remain excluded from DeepSeek attribution.
- DP-003 accepted A, B, C, D and F unanimously (4/4). E was accepted 3/4; Kimi rejected E. Exact votes and implementation state are in `docs/DRIVER_PATAP_DECISIONS.md`.
- Implemented since the audit: schema v4 immutable principal Owner, host-specific CSP, private POST nearby query, native Driver API ES module, recursive Driver build and server Driver location module boundary.
- The defect/risk and test sections below describe the pre-DP-003 audit point. Current status supersedes them: Owner/CSP/nearby issues are fixed as described above; chat, radio and the remaining V1 scope are still missing.

## Source of truth

Первичное утверждённое ТЗ прочитано полностью. Текущая и ранее документированная копии имеют одинаковый SHA-256:

```text
D1D3D8048EE947F66794E1C5CD9ABBCB31E6042F1D072FA3CAADF05BAF8A56F2
```

Старый Truck Social Map исключён и не использовался. `.git` существует, но Git CLI недоступен; status/diff/log обозначаются `UNKNOWN`.

## Confirmed implementation

- общая Patap-аутентификация, cookie/CSRF boundary и одна SQLite database;
- отдельный Driver build и публичный host `driver.patap.eu`;
- Driver profile с уникальным nickname и типом `TIR|TAXI|DELIVERY|GENERAL`;
- MapLibre map, явные GPS/visibility controls, latest-location-only storage;
- nearby API с серверным расстоянием, радиусами 5/25/50/100 км, stale threshold 60 секунд и исключением self;
- общие Patap admin endpoints для пользователей, ролей, disable/enable, sessions и audit.

## Confirmed missing V1

- карта как главный экран и навигация `MAP|CHAT|RADIO|PARKING|PROFILE`;
- real chat/messages и realtime transport;
- radio/PTT, one-speaker arbitration и audio delivery;
- parking, friends, minimal notifications, Owner contact;
- Driver-specific Owner administration, complaints и module moderation;
- реальная multi-account/multi-device/mobile acceptance.

Communities и rating остаются post-V1 по DP-001 и не показываются как готовые функции.

## Confirmed defects and risks

- код допускает назначение дополнительных Owner и не фиксирует immutable principal Owner, хотя production DB фактически содержит одного активного Owner;
- MapLibre OSM/blob CSP применяется глобально, а не только к Driver host;
- `openProfile()` выключает видимость и удаляет location при reload/login; это privacy-safe default DP-002, но persistent UX требует решения;
- nearby требует свежую опубликованную location запрашивающего; reciprocity policy не утверждена;
- GPS browser test использует fake MapLibre/geolocation/API и не является real-device E2E;
- client и server пока монолитны: три Driver-файла и один общий auth server.

## Tests actually run

- `npm.cmd run verify`: PASS; auth 7/7, client 2/2, PlatformOS PASS;
- `npm.cmd run test:browser`: PASS;
- `status-patap-stack.cmd`: `HEALTHY`;
- production SQLite: `integrity_check=ok`, migration version 3;
- public Driver route и MapLibre asset: HTTP 200; unauthenticated nearby: HTTP 401.

## AI-team provenance

- GPT, DeepSeek и Kimi tabs реально обнаружены и прочитаны в авторизованном Chrome.
- DP-001 repository record: Codex, GPT и Kimi `APPROVE`; DeepSeek `NO_RESPONSE` на отдельное голосование.
- GPT и Kimi DP-002 approvals подтверждены живыми чатами.
- Ответы на странице DeepSeek, подписанные `FROM=GPT`, не приписываются DeepSeek; запрошено исправление attribution.
- Новый factual recovery report реально отправлен всем трём. GPT и Kimi вернули reviews; корректный DeepSeek response ожидается.

## Bounded research result

- client candidate: native browser ES modules без bundler, relative imports и рекурсивный static build;
- chat candidate: REST/SQLite как источник истины + authenticated WebSocket для committed events и ephemeral state + cursor resync;
- radio candidate: store-and-forward PTT, server-authoritative speaker lease через WebSocket и CSRF-protected HTTPS audio upload после отпускания кнопки;
- parking: раздельные static attributes и crowd observations с source, observed time, freshness и confirmations;
- UI: map-first, крупные one-hand targets, явные stale/offline/reconnecting states;
- anonymous chat, decorative rating, proprietary navigation и неутверждённая audio history не добавляются.

Research не является реализацией или автоматическим расширением V1. Источники и варианты переносятся в decision record перед голосованием.

## Next controlled action

До chat implementation требуется согласовать recovery/security/core package:

1. immutable single Owner model;
2. host-specific CSP;
3. modular client/server boundaries без изменения публичных API;
4. решение о visibility persistence и nearby reciprocity;
5. real authenticated two-account Driver acceptance baseline;
6. актуальная acceptance matrix.

Driver V1 не завершён.
