# DRIVER PATAP — AUDIT CORRECTIONS

Дата: 2026-08-21 Europe/Warsaw
База проверки: `codex/local-workspace-snapshot @ 2ccf14c1ac6f58829d3222988ccd74457f5c8bef`

## AUD-005 — GPS_RATE_CONTRACT_V1

**Исправленный статус:** FALSE POSITIVE — NO PRODUCT CODE CHANGE REQUIRED FOR THE CLAIMED 10s/12s MISMATCH.

### Что было ошибочно записано в основном audit register

Основной реестр утверждал, что:
- клиент `driver/gps/index.js` отправляет позицию не чаще одного раза в 10 секунд (`SEND_THROTTLE_MS = 10_000`);
- серверный вызов `checkRate(..., 1, 1 / 12)` якобы означает одно обновление примерно раз в 12 секунд;
- поэтому нормальный клиент должен периодически получать `429 location_rate_limited`.

Последующее чтение реализации `server/auth/server.js::checkRate()` показало, что третий параметр называется `windowMinutes` и новый `reset_at` вычисляется через `addMinutes(windowMinutes)`.

Следовательно:

```text
1 / 12 minute = 5 seconds
```

Серверное окно для `driver-location` на проверенном snapshot — примерно 5 секунд, а штатный клиент throttled до 10 секунд. Сам по себе этот контракт не создаёт заявленного self-429.

### Проверенный код

`server/auth/server.js`:

```js
function checkRate(key, limit, windowMinutes) {
  const now = nowIso();
  const row = db.prepare("SELECT * FROM rate_limits WHERE key = ?").get(key);
  if (!row || row.reset_at <= now) {
    db.prepare("INSERT OR REPLACE INTO rate_limits(key, count, reset_at) VALUES(?, ?, ?)")
      .run(key, 1, addMinutes(windowMinutes));
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").run(key);
  return true;
}
```

`server/driver/routes.js`:

```js
checkRate(`driver-location:user:${session.user.id}`, 1, 1 / 12)
```

`driver/gps/index.js`:

```js
const SEND_THROTTLE_MS = 10_000;
```

### Остаточное наблюдение, не равное исходному AUD-005

Клиент выставляет `lastSentAt = Date.now()` перед подтверждением успешного HTTP update. Это означает, что неуспешная отправка также запускает локальный throttle. Это может быть отдельным небольшим resilience/UX улучшением, но не доказывает штатный `429` и не имеет приоритета P1/P2 без наблюдаемого вреда.

### Решение

- Не менять интервалы GPS ради исходного AUD-005.
- Не создавать фиктивный repair PR.
- В основном audit register пункт AUD-005 следует считать superseded этим correction до следующей редакции реестра.
- Если позже появится фактический `429` на реальном клиенте, исследовать по timestamp/log с учётом нескольких вкладок/устройств и реального `reset_at`, а не исходить из ошибочного «12 секунд».
