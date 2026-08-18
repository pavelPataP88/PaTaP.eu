# Radio Console V2 — PaTaP Driver

## Цель

Сделать рацию самостоятельным полноценным продуктовым экраном Driver Patap, а не приложением к чату или карте. Текущий блок не объединяет разделы между собой: карта остаётся картой, чат — чатом, рация — рацией.

Интерфейс, код, названия сущностей и визуальный язык — оригинальные PaTaP. Из Zello используются только проверенные продуктовые принципы, без копирования кода, иконок, CSS, изображений, текстов, trade dress или точной компоновки экранов.

## Официальное исследование → решение PaTaP

| Проверенный принцип | Оригинальная реализация PaTaP | Почему / отличие |
|---|---|---|
| Zello Work использует групповые каналы и разные channel types для разных рабочих сценариев. | PaTaP оставляет три понятных пространства: `GENERAL`, `GROUP`, `DIRECT`. | Не копируем Team/Dynamic/Hidden/Dispatch 1:1. Это более простая модель для Driver сейчас и она совместима с существующим DIRECT radio. |
| В Zello есть Everyone channel, охватывающий сеть. | `Общий эфир` создаётся как системный GENERAL-канал; Driver автоматически становится его участником при первом использовании Radio. | Даёт общий голосовой эфир без ручного создания канала. |
| Zello различает открытые и защищённые каналы. | GROUP бывает `PUBLIC` (поиск + добровольное вступление) и `PRIVATE` (только приглашение). | PRIVATE invitation дополнительно требует подтверждённого Driver-контакта. |
| Zello channel moderation использует owner/admin/moderator и trusted/listen-only возможности. | Роли PaTaP: `OWNER`, `MODERATOR`, `TRUSTED`, `MEMBER`, `LISTENER`. | Права проверяются сервером, а не доверяются кнопкам UI. OWNER может передать владение; MODERATOR не может удалить OWNER или равного MODERATOR. |
| Zello позволяет ограничивать, кто говорит в канале: открытый эфир, trusted/Zelect, listen-only/broadcast сценарии. | Политики PaTaP: `EVERYONE`, `TRUSTED`, `BROADCAST`. | `EVERYONE`: говорят все кроме LISTENER. `TRUSTED`: OWNER/MODERATOR/TRUSTED. `BROADCAST`: только OWNER/MODERATOR. |
| Zello показывает Recents, Channels и отдельные разговоры/контакты. | В Radio Console отдельные вкладки `Недавние`, `Каналы`, `Прямые`, плюс локальный фильтр. | Это оригинальная двухпанельная консоль PaTaP; не копируется точный layout Zello. |
| Непрослушанные сообщения в Zello заметны в Recents/History. | У канала есть server-side `last_read_transmission_id` и `unreadCount`; выбранный канал помечается прочитанным. | Не хранится отдельная копия аудио и не меняется retention. |
| Zello статусы Available/Busy/Solo управляют входящим live audio. | `AVAILABLE`, `BUSY`, `SOLO`; Solo привязан к одному выбранному каналу. | Busy отключает автоматический live playback, но история сохраняется. Solo пропускает live playback только выбранного канала. |
| Можно назначить default channel/contact для быстрого возврата к основному эфиру. | Один `defaultChannelId`, который поднимается в начало списка и выбирается при старте Radio Console. | Автопереключение через 20 секунд намеренно не копируется: оно может неожиданно сменить контекст водителю. |
| Zello History умеет последовательное воспроизведение и 1.25×/1.5×. | История PaTaP последовательно проигрывает следующий элемент; пользователь выбирает 1× / 1.25× / 1.5×. | Скорость сохраняется в radio user settings. |
| Zello поддерживает replay последнего сообщения. | Кнопка `Повтор` в обычном и Driving Mode. | Повторяет последний доступный transmission текущего канала. |
| Zello Work поддерживает pinned messages (до трёх в канале). | До 3 закреплённых voice transmissions поверх истории. | В PaTaP закреплять может OWNER/MODERATOR; это более строгая политика, чем разрешить всем участникам. DIRECT не имеет pins. |
| Zello channel alerts дают способ привлечь внимание. | `Вызов` — короткоживущий `ATTENTION` alert с TTL 5 минут. | Это НЕ emergency/SOS. PaTaP не записывает автоматически звук и не прикладывает геолокацию. GENERAL alert отключён. |
| Zello Echo помогает проверить аудио. | `Тест микрофона` записывает ~3 сек локально и тут же воспроизводит Blob. | Никаких контактов Echo и серверной отправки: тест полностью остаётся на устройстве. |
| Zello Car Mode упрощает управление за рулём. | `Режим вождения`: огромный PTT, предыдущий канал / повтор / следующий канал / выход; обычная история и настройки скрыты. | Не копируются swipe-жесты Zello и интеграция Google Maps. Интерфейс рассчитан на закреплённое устройство; водитель не должен работать с экраном во время движения. |
| Zello даёт быстрые обновления talk screen и history. | Отдельный authenticated SSE `/api/driver/radio/events` посылает только generic `radio.refresh`; клиент затем получает свой защищённый `/overview`. Есть fallback poll 12 сек. | Push не содержит nickname/channel/transmission data и не вмешивается в существующий Chat WebSocket. |

## Официальные источники

Проверены 18 августа 2026 года:

- Zello Work Channel Types: https://support.zello.com/zw/channel-types
- Zello Work Creating and configuring channels: https://support.zello.com/zw/creating-and-configuring-channels-management-console
- Zello Work Setting Up User Roles: https://support.zello.com/zw/setting-up-user-roles
- Zello channel moderation guidelines: https://support.zello.com/zc/channel-moderation-guidelines
- Zello moderators vs administrators: https://support.zello.com/zc/channel-moderators-vs.-channel-administrators
- Zello Work Default Channel: https://support.zello.com/zw/default-channel-or-contact-an-overview
- Zello Car Mode: https://support.zello.com/zc/using-car-mode-android
- Zello Android User Guide / Recents, continuous history, playback speed: https://support.zello.com/zc/android-user-guide
- Zello Work Pinned Messages: https://support.zello.com/zw/pinned-messages
- Zello statuses: https://support.zello.com/zc/understanding-statuses
- Zello Work Echo audio test: https://support.zello.com/zw/testing-audio-with-echo
- Zello Work Emergency Channel Settings + Roles, использован только как источник role/listen-only принципа; emergency behavior НЕ переносится: https://support.zello.com/zw/emergency-channel-settings-roles

## Radio Console V2 — функциональность

### Каналы

- системный `Общий эфир`;
- пользовательские GROUP-каналы;
- прежние DIRECT-каналы между подтверждёнными контактами;
- PUBLIC discovery + join;
- PRIVATE invite + accept/decline;
- описание канала;
- favorite;
- mute;
- default;
- unread counter;
- видимый текущий speaker;
- участники и роли;
- owner transfer;
- remove / channel ban;
- leave;
- delete GROUP с удалением принадлежащей ему аудиоистории.

### Разрешения речи

- EVERYONE;
- TRUSTED;
- BROADCAST;
- LISTENER всегда не получает PTT;
- правила проверяются в `server/radio/repository.js` перед выдачей lease.

### PTT

Все уже проверенные свойства RADIO_EXPERIENCE_V1 сохранены:

- hold-to-talk;
- pointer release;
- drag-out cancel;
- pointercancel/lost capture;
- Space/Enter;
- Escape;
- 550 ms accidental-tap guard;
- 60 sec maximum;
- 3 MiB maximum;
- existing pending speaker lease;
- existing upload token;
- cancellation освобождает только собственный pending lease;
- delivery не показывается без server confirmation / проверенного transmissionId;
- race `upload commit vs lost response` сохраняет двойную проверку.

### История и звук

- максимум запрашиваемых клиентом 50 последних элементов текущего канала;
- серверный retention остаётся 30 дней;
- custom audio player;
- sequential playback;
- replay last;
- 1× / 1.25× / 1.5×;
- autoPlay incoming committed transmission;
- per-channel mute;
- Busy / Solo filter;
- own transmission не auto-play;
- pins.

### Live refresh

SSE используется только как invalidation-сигнал:

1. серверное radio-событие меняет состояние;
2. всем авторизованным SSE-клиентам отправляется `radio.refresh` + короткая reason-строка;
3. никакие channel ids, nicknames, transmission ids, роли или аудиоданные через SSE не рассылаются;
4. клиент выполняет свой `/api/driver/radio/overview` и получает только доступные ему данные;
5. если SSE недоступен, остаётся fallback poll каждые 12 секунд.

## Важная транспортная граница

`RADIO_CONSOLE_V2` НЕ заявляет настоящую streaming-рацию во время удержания PTT.

Текущий проверенный транспорт остаётся:

`PTT lease → MediaRecorder → release → binary upload → commit → SSE refresh → playback у слушателей`.

Поэтому состояние speaker видно почти сразу после выдачи lease, а завершённая передача появляется и может автоматически проиграться почти сразу после commit. Однако слушатель не слышит звук посекундно, пока говорящий ещё удерживает PTT.

Настоящий sub-second live audio потребует отдельного транспортного блока (например, WebRTC/streaming audio gateway), с отдельными тестами NAT/reconnect/jitter/audio focus/lease arbitration. Он намеренно не смешивается с этой большой UI/channel работой, чтобы не разрушить уже проверенную безопасность передачи и историю.

## Что намеренно не добавлено

- интеграция с картой;
- GPS/dynamic geo channels;
- чат внутри Radio;
- текст/фото/location сообщения;
- emergency/SOS semantics;
- автоматическая запись микрофона;
- фоновой microphone capture;
- per-user audio mixer/volume — требует отдельного Web Audio/mixer блока;
- реклама;
- внешние сервисы;
- копии Zello assets/design.

## Схема данных

Существующие legacy таблицы `radio_channels`, `radio_channel_members`, `radio_direct_pairs`, `radio_speaker_leases`, `radio_transmissions` не ALTER/DROP.

Новый модуль имеет собственную аддитивную schema-version `radio_schema_meta = 1` и таблицы только для Radio Console: profiles, member state, invites, bans, user settings, alerts, pins. Глобальная `schema_migrations` остаётся 12. Это ограничивает радиус изменения только radio-модулем и сохраняет старые auth/chat/map migrations неизменными.

## Критерий готовности перед production

Codex должен проверить весь diff и выполнить минимум:

- `npm run test:auth`;
- `npm run test:driver-modules`;
- `npm run build`;
- `npm run verify`;
- isolated browser test;
- двухпользовательский DIRECT PTT smoke;
- трёхпользовательский GROUP roles/PTT smoke;
- PRIVATE invite;
- PUBLIC discover/join;
- ban/rejoin protection;
- SSE immediate refresh + fallback;
- Busy/Solo/mute/autoplay;
- pins;
- Echo local-only;
- Driving Mode на телефоне/планшете;
- после schema change — backup перед применением к рабочей SQLite.
