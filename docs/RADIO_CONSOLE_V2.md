# RADIO_CONSOLE_V2 — PaTaP Driver

## Статус

Это каноническое инженерное описание кандидата `chatgpt/radio-console-v2`.

Рация остаётся самостоятельным разделом Driver. Этот блок не объединяет её с картой или чатом.

Интерфейс, код, названия, CSS и серверная модель — оригинальные PaTaP. Из Zello использованы только общие продуктовые принципы; код, иконки, изображения, тексты, CSS, trade dress и точная компоновка экранов не копировались.

## Проверенные продуктовые ориентиры Zello

Официальные материалы, использованные при проектировании:

- Channel Types — https://support.zello.com/zw/channel-types
- Creating and configuring channels — https://support.zello.com/zw/creating-and-configuring-channels-management-console
- Setting Up User Roles — https://support.zello.com/zw/setting-up-user-roles
- Channel moderation guidelines — https://support.zello.com/zc/channel-moderation-guidelines
- Default Channel or Contact — https://support.zello.com/zw/default-channel-or-contact-an-overview
- Car Mode — https://support.zello.com/zc/using-car-mode-android
- Android User Guide / Recents / History — https://support.zello.com/zc/android-user-guide
- Pinned Messages — https://support.zello.com/zw/pinned-messages
- Statuses — https://support.zello.com/zc/understanding-statuses
- Testing audio with Echo — https://support.zello.com/zw/testing-audio-with-echo

## Что реализовано

### Каналы

Эффективные типы радио-пространств:

- `GENERAL` — системный `Общий эфир`;
- `GROUP` — пользовательские групповые каналы;
- `DIRECT` — существующая 1:1 рация между подтверждёнными Driver-контактами.

GROUP поддерживает:

- `PUBLIC` / `PRIVATE`;
- создание, поиск открытых каналов, вступление и выход;
- приглашения только подтверждённых контактов;
- описание и число участников;
- удаление канала владельцем;
- бан / разбан;
- избранное, mute, unread и канал по умолчанию;
- до трёх закреплённых голосовых передач;
- временный сигнал внимания `ATTENTION`.

### Роли и право говорить

Роли:

- `OWNER`
- `MODERATOR`
- `TRUSTED`
- `MEMBER`
- `LISTENER`

Политики PTT:

- `EVERYONE`
- `TRUSTED`
- `BROADCAST`

Право говорить проверяется сервером при получении PTT lease и повторно при live/final upload. Если роль, политика канала или membership изменились во время передачи, pending lease и незавершённая передача отзываются немедленно.

### Radio Console

Экран содержит:

- `Недавние / Каналы / Прямые`;
- поиск/фильтр каналов;
- активного говорящего;
- большую PTT-кнопку;
- создание и поиск GROUP;
- приглашения и участников;
- управление ролями;
- `AVAILABLE / BUSY / SOLO`;
- default channel;
- favorite / mute / unread;
- replay последней передачи;
- последовательное воспроизведение истории;
- скорость 1× / 1.25× / 1.5×;
- pins;
- attention alert;
- локальный Echo-test микрофона;
- отдельный Driving Mode.

### Driving Mode

Оставляет минимум крупных действий:

- большой PTT;
- предыдущий канал;
- повтор;
- следующий канал;
- выход из Driving Mode.

Это интерфейс для установленного телефона/планшета, а не разрешение отвлекаться на экран при движении.

## PTT и надёжная история

Сохранены правила ранее развернутого `RADIO_EXPERIENCE_V1`:

- зажал → говоришь;
- отпустил → завершение;
- короткий тап `<550 ms` не сохраняется;
- drag-out / Escape / pointercancel / потеря фокуса останавливают передачу и не сохраняют историю;
- максимум 60 секунд;
- сохранённое аудио максимум 3 MiB;
- speaker lease;
- одноразовый upload token;
- чужой lease/token не может быть отменён;
- `Доставлено` показывается только после подтверждённого commit или повторной проверки фактической истории;
- потерянный upload-response не превращается в ложный успех.

## Live-аудио во время удержания PTT

Кандидат добавляет best-effort near-live path, не заменяя надёжную сохранённую историю.

### Защита от случайного тапа

Первые `550 ms` live-аудио буферизуются только на устройстве отправителя.

- если PTT отпущен/отменён раньше порога — live PCM наружу не отправляется;
- если удержание настоящее — накопленный старт выпускается в live relay;
- это намеренно добавляет примерно 550 ms к минимальной live-задержке ради сохранения безопасной семантики короткого тапа.

После того как звук уже реально прозвучал у слушателей, отмена может остановить дальнейший эфир и не сохранять историю, но не может «отозвать» уже услышанную часть. UI прямо сообщает об этом.

### Sender

После успешного PTT lease один и тот же `MediaStream` используется двумя путями:

1. обычный `MediaRecorder` продолжает собирать полную передачу для надёжной истории;
2. Web Audio best-effort downsample до mono PCM16 16 kHz;
3. live chunks примерно по 4,000 samples (~250 ms) отправляются через защищённый POST `/api/driver/radio/live/:transmissionId`;
4. каждый chunk требует существующий `X-Radio-Upload-Token`, sequence и sample rate;
5. normal release досылает захваченный хвост и `end/finalSequence`;
6. затем обычный MediaRecorder blob коммитится существующим upload endpoint.

Если live path падает, сохранённая история продолжает работать отдельно.

### Server relay

`server/radio/live-http.js`:

- не пишет live PCM на диск;
- не создаёт вторую историю;
- проверяет session, Driver profile, CSRF, активный PTT lease и upload token;
- повторно проверяет право отправителя говорить через `radio.uploadTarget(...)`;
- проверяет доступ каждого слушателя к каналу перед relay;
- не отправляет live обратно самому speaker;
- chunk ≤12 KiB;
- ≤320 chunks и ≤2.4 MB live PCM на одну передачу;
- sequence должен монотонно расти;
- stale relay counters удаляются;
- `/live-events` принудительно закрывается раз в 60 секунд; стандартный EventSource reconnect заново проходит session validation, поэтому отозванная session не может бесконечно получать живой эфир через старое соединение.

### Listener

`Живой звук` — явный opt-in. При включении пользовательским жестом разблокируется AudioContext.

Автоматическое live-воспроизведение учитывает:

- mute канала;
- `BUSY`;
- `SOLO` и его channelId;
- membership/access сервера.

PCM chunks проигрываются через небольшой jitter buffer.

### Completion / duplicate protection

Listener считает передачу полностью услышанной live только если:

- sequence не имел разрыва;
- пришёл server `end` marker;
- `finalSequence` совпал с последним полученным sequence.

Только тогда committed copy не запускается автоматически второй раз.

При пропущенном chunk/end marker сохранённая история остаётся полным fallback.

## Realtime state

Два SSE потока:

- `/api/driver/radio/events` — только generic `radio.refresh`; приватных channel/transmission payload там нет;
- `/api/driver/radio/live-events` — live PCM только для авторизованных участников доступных каналов.

Для обычного состояния остаётся 12-секундный HTTP poll fallback.

## Схема данных

Существующие transport-таблицы не ALTER/DROP:

- `radio_channels`
- `radio_channel_members`
- `radio_direct_pairs`
- `radio_speaker_leases`
- `radio_transmissions`

Новые возможности используют отдельную аддитивную module schema `radio_schema_meta = 1`:

- channel profiles;
- member state;
- invites;
- bans;
- settings;
- alerts;
- pins.

Глобальная auth `schema_migrations` остаётся 12.

## Что сознательно не сделано

- Map/GPS integration;
- текстовый чат внутри Radio;
- SOS/emergency semantics;
- фоновая или автоматическая запись микрофона;
- WebRTC/TURN;
- per-user audio mixer/volume;
- копирование Zello assets/UI.

## Масштабируемость live path

Текущий live transport — пилотная реализация для проверки продукта, а не финальный массовый media transport.

PCM16 16 kHz mono — около `256 kbit/s` raw; base64/SSE добавляет overhead. При большом числе слушателей server relay масштабируется хуже Opus/WebRTC. До массовых каналов нужно измерить CPU, память, трафик и задержку. Возможный следующий технический этап — AudioWorklet + Opus/WebCodecs или отдельный realtime media transport.

`createScriptProcessor(...)` также deprecated; его обязательно проверить на реальных Android/Chromium устройствах проекта. Надёжная post-release history не зависит от live processor.

## Что обязан проверить Codex

Автоматически на изолированной среде:

- `npm ci`
- `npm run test:auth`
- `npm run test:radio-live`
- `npm run test:driver-modules`
- `npm run build`
- `npm run verify`
- `npm run test:browser` там, где browser network policy позволяет.

Перед backend restart:

- backup рабочей SQLite.

Ручной test-Driver smoke:

1. legacy DIRECT accepted-contact rule;
2. GENERAL;
3. PUBLIC/PRIVATE GROUP;
4. invitations/discovery/join/leave;
5. OWNER/MODERATOR/TRUSTED/MEMBER/LISTENER;
6. EVERYONE/TRUSTED/BROADCAST;
7. активный PTT немедленно отзывается при demotion/policy change/remove;
8. ban/rejoin protection;
9. Busy/Solo/mute/default/favorite/unread;
10. pins/replay/sequential history/speed;
11. Echo ничего не отправляет на сервер;
12. Car Mode на ~390 px и планшете;
13. второй авторизованный Driver слышит live во время удержания PTT;
14. short tap <550 ms не слышен live и не сохраняется;
15. cancel после начала live прекращает следующие chunks и не сохраняет историю;
16. live endpoint failure не ломает final history commit;
17. full live + finalSequence не даёт двойной autoplay;
18. incomplete live оставляет history fallback;
19. SSE не буферизуется Caddy/Cloudflare;
20. 60-second PTT: измерить latency, continuity, CPU/memory/network.

Production/main этот кандидат сам не меняет. Codex применяет его только после PASS и отдельного production backup/restart решения.
