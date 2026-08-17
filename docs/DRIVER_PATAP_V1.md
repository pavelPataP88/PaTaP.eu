# Driver Patap V1

## Current GPS policy — user directive (implemented 2026-07-14)

- one server-persisted `Driver и GPS` switch replaces the independent GPS/visibility controls;
- ON automatically restores after refresh/login, publishes the latest coordinate and enables reciprocal nearby visibility;
- OFF deletes the server coordinate, clears all markers, blocks nearby access and excludes the user from other results;
- SQLite schema v6 stores `gps_enabled`; `POST /api/driver/nearby` derives the origin from the caller's fresh stored location and accepts only the radius;
- logout deletes the live coordinate but preserves the preference for the next login;
- the older DP-002 rules below are retained as historical implementation context and are superseded where they conflict.

## Historical DP-002 — GPS + Map foundation (implemented 2026-07-13)

Фактически реализовано:

- локально поставляемый MapLibre GL JS 5.24.0 и отдельный Driver build;
- replaceable JSON-конфигурация raster tile URL; сейчас используется `https://tile.openstreetmap.org/{z}/{x}/{y}.png` с постоянной видимой атрибуцией OpenStreetMap;
- карта доступна после загрузки Driver-профиля и не включает GPS автоматически;
- независимые переключатели «GPS» и «Показывать меня»: оба `off` по умолчанию;
- `navigator.geolocation.watchPosition` вызывается только после явного включения GPS, а `clearWatch` — при выключении, logout и отказе разрешения;
- локальная позиция может использоваться без публикации; выключение видимости вызывает `DELETE /api/driver/location`, но не останавливает GPS;
- выключение GPS также выключает видимость, удаляет серверную позицию и локальный маркер;
- публикация последней позиции ограничена клиентом до одного запроса за 10 секунд; ошибки API не отображаются как успешная публикация;
- SQLite migration v3 создаёт `driver_locations` с одной строкой на пользователя; история перемещений не хранится;
- `PUT /api/driver/location` валидирует числовые latitude/longitude/accuracy, требует auth + CSRF и игнорирует клиентский timestamp;
- `DELETE /api/driver/location` идемпотентен и требует auth + CSRF;
- `GET /api/driver/nearby` требует auth, принимает только 5/25/50/100 км, исключает самого пользователя и записи старше 60 секунд, вычисляет расстояние на сервере и возвращает минимальный публичный профиль;
- маркеры соседних водителей обновляются и удаляются при исчезновении из ответа.

Security/runtime boundary:

- Driver CSP разрешает только собственные scripts/styles/fonts, `blob:` worker MapLibre и соединение к точному OSM tile origin; inline script/style не разрешены;
- Permissions-Policy: `geolocation=(self)`, камера запрещена;
- OSM public tiles требуют сети, не обеспечивают offline mode и не должны массово кешироваться или prefetch-иться. Для роста нагрузки tile endpoint нужно заменить на подходящего провайдера/собственный сервис с его условиями использования.

Проверка DP-002:

- auth API tests: 7/7 PASS, включая auth, CSRF, validation, radius, staleness, own-user exclusion, upsert, deletion и rate limit;
- client browser tests: 2/2 PASS, включая отсутствие GPS на старте, независимость controls, throttle, API failure и permission denied;
- build/verify и синтаксические проверки: PASS;
- локальный Caddy и backend health: PASS; публичный Driver и unauthenticated API boundary: PASS;
- реальный Chrome загрузил публичную login-страницу без console errors и без permission prompt. Authenticated ручная GPS-проверка не выполнена из-за отсутствия активной общей сессии в Chrome; это не подменяется утверждением о полном ручном E2E.

DP-002 завершён в указанном объёме. Карта, GPS и публикация последней позиции готовы как foundation; Driver V1 целиком не объявлен готовым.

## Исторический этап 2026-07-13: оболочка и профиль до DP-002

Этот раздел является снимком прошлого этапа. Указанные ниже ограничения и числа тестов не заменяют актуальную сводку DP-002 в начале файла.

Реализовано и проверено в репозитории:

- отдельные исходники Driver: `driver/index.html`, `driver/styles.css`, `driver/app.js`;
- отдельный build output `var/build/driver`, не смешанный с `var/build/dist` Patap Lab;
- host-aware маршрут Caddy для `driver.patap.eu` с отдельным web root;
- доступ к микрофону и геолокации разрешён политикой браузера только Driver-host; камера запрещена;
- миграция SQLite версии 2 создаёт `driver_profiles`, связанный внешним ключом с существующим `users.id`;
- обязательны уникальный никнейм и один из типов `TIR`, `TAXI`, `DELIVERY`, `GENERAL`;
- доступны редактируемые необязательные поля: настоящее имя, автомобиль, язык, страна и город;
- `GET /api/driver/profile` и `PUT /api/driver/profile` требуют существующую Patap-сессию; изменение профиля дополнительно требует CSRF;
- UI выполняет реальный вход через существующий `/api/login`, загружает, создаёт и редактирует серверный профиль;
- `/api/session` обновляет существующую host-only сессию в общую cookie `Domain=patap.eu` при обращении через доверенный публичный host.

Перед миграцией создана проверенная резервная копия:

```text
data/auth/backups/patap-auth-2026-07-13T18-29-12-635Z.sqlite
```

Фактические результаты проверки:

- `caddy validate --config Caddyfile.tunnel --adapter caddyfile`: valid configuration;
- `npm run verify`: PASS;
- auth tests: 6 PASS, 0 FAIL;
- client-storage tests: 1 PASS, 0 FAIL;
- PlatformOS runtime tests: PASS.

Ограничения этапа:

- В Cloudflare Tunnel `patap-lab` добавлен published application route `driver.patap.eu -> http://127.0.0.1:8090`; Cloudflare подтвердил автоматическое создание CNAME на `3fcb984b-9a1e-4874-b98c-39d73da50c72.cfargotunnel.com`.
- Публичный HTTPS Driver проверен прямым запросом через подтверждённый Cloudflare IP: HTTP 200, Cloudflare TLS, корректные CSP/HSTS/Permissions-Policy и отдельный Driver HTML.
- Пользовательский Chrome сразу после создания DNS ещё держал отрицательный DNS-кэш и вернул `ERR_NAME_NOT_RESOLVED`; публичный cross-subdomain login/profile сценарий остаётся непроверенным;
- фотография профиля, online/GPS/visibility state, карта, чат, рация, парковки, друзья, уведомления и Driver-admin ещё не реализованы;
- Driver V1 не объявлен готовым.

Повторный запрос DeepSeek был реально отправлен и ожидался 45 секунд. Содержательного ответа не получено; интерфейс показал только «Сообщение пусто». Это не трактуется как голос или отказ.

Дата фиксации: 2026-07-13.

## Статус документа

Этот файл фиксирует только подтверждённое состояние проекта, принятое голосование и контролируемый объём V1. Полное пользовательское ТЗ остаётся главным источником требований.

Проверенный исходный документ:

```text
C:\Users\Biuro\.codex\attachments\3c3f31bf-0bcc-486f-9b6b-34a49d06715b\pasted-text.txt
SHA-256=d1d3d8048ee947f66794e1c5cd9abbcb31e6042f1d072fa3caadf05baf8a56f2
```

Старый Truck Social Map исключён из проекта и не используется как источник кода, архитектуры или требований.

## Подтверждённая исходная точка

- Рабочий Patap Lab использует статическую сборку `index.html`, `styles.css`, `app.js` в `var/build/dist`.
- Backend авторизации реализован на Node.js и встроенной SQLite.
- Единственная база аккаунтов содержит пользователей, сессии, роли, аудит, rate limits и reset tokens.
- Caddy отдаёт один публичный dist и проксирует `/api/*` на `127.0.0.1:8091`.
- До начала этого этапа cookie сессии была host-only, а `https://driver.patap.eu` отсутствовал в CSRF allowlist.
- До начала этого этапа в репозитории не было реализации Driver Patap.
- До создания Cloudflare route 2026-07-13 `driver.patap.eu` не разрешался в DNS; route и CNAME теперь созданы и публичный HTTPS отвечает.
- Перед первым изменением auth создана проверенная резервная копия `data/auth/backups/patap-auth-2026-07-13T18-00-26-910Z.sqlite`; backup-скрипт завершил `PRAGMA integrity_check` успешно.

## Проверенная связь ИИ-команды

В Chrome фактически обнаружены авторизованные вкладки ChatGPT, DeepSeek и Kimi. Полное ТЗ было реально отправлено во все три сервиса, после чего от каждого получен реальный ответ. Ответы ИИ считаются мнениями, а не доказательствами состояния репозитория.

Для первого голосования одинаковый запрос был отправлен GPT, DeepSeek и Kimi. GPT и Kimi вернули явные голоса. DeepSeek после первоначального ответа на ТЗ не вернул голос на отдельный запрос даже после одной повторной отправки; его голос не выводился по предположению.

## Решение DP-001: стек, интеграция и объём V1

Голоса:

| Участник | Стек | Друзья | Минимальные уведомления | Сообщества после V1 | Рейтинг после V1 | Единый auth | Сначала архитектура и тесты |
|---|---|---|---|---|---|---|---|
| Codex | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE |
| GPT | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE |
| Kimi | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE |
| DeepSeek | NO_RESPONSE | NO_RESPONSE | NO_RESPONSE | NO_RESPONSE | NO_RESPONSE | NO_RESPONSE | NO_RESPONSE |

Итог: решение принято 3 реальными голосами из 4.

Утверждено:

- сохранить Node.js + SQLite для V1;
- добавить realtime-транспорт без миграции базы на другой движок, пока не найден проверенный блокер;
- Driver остаётся отдельным продуктом на `driver.patap.eu`, но использует те же аккаунты, пользователей, сессии и роли Patap;
- отдельная регистрация, пароль или дублирующая таблица пользователей запрещены;
- друзья входят в V1;
- в V1 входят только минимальные серверные уведомления для запросов в друзья, чата, рации и системных событий;
- сообщества остаются утверждённой возможностью полного продукта, но переносятся после V1;
- рейтинг переносится после V1 и не показывается до появления реальной формулы, истории и защиты от накрутки;
- до функциональных модулей создаются архитектурная граница Driver, приёмочные сценарии, миграции и тесты общей авторизации.

## Целевой пользовательский опыт V1

Главный экран — карта. Постоянная нижняя навигация:

```text
MAP | CHAT | RADIO | PARKING | PROFILE
```

Правила интерфейса:

- мобильный экран и управление одной рукой являются основным сценарием;
- большие основные цели нажатия, минимум действий во время движения;
- точное состояние GPS, сети, видимости и свежести данных всегда понятно;
- пользователь явно включает и выключает свою видимость;
- маркер показывает время последнего обновления и визуально устаревает;
- текущие, исторические и неизвестные данные парковки не смешиваются;
- вклад в парковку должен быть коротким, иметь время, автора и подтверждение другими водителями;
- переход во внешнюю навигацию допустим в V1; собственная полноценная навигация не заявлена;
- рация использует hold-to-talk, явно показывает свободный/занятый/передающий/получающий канал и допускает только одного активного говорящего;
- потеря сети, отказ в разрешении GPS/микрофона и approximate location являются нормальными состояниями UI;
- сообщества и рейтинг не отображаются в V1.

## Целевая модульная граница

Планируемая структура отдельного продукта:

```text
driver/
  core/
  map/
  gps/
  profile/
  users/
  friends/
  chat/
  radio/
  parking/
  notifications/
  admin/
  shared/
```

Фактические каталоги создаются только вместе с рабочим кодом соответствующего этапа. Отключённый `modules/transport` не используется как реализация Driver.

Серверные правила:

- `users.id` остаётся единственным идентификатором аккаунта;
- данные Driver связываются с существующим `users.id` внешними ключами;
- права, видимость, членство, модерация и Owner-действия проверяются сервером;
- WebSocket/другой realtime-транспорт обязан аутентифицироваться существующей Patap-сессией;
- таблицы Driver добавляются версионированными миграциями в существующую SQLite, без второй базы пользователей;
- публичный API не раскрывает пути, схему защиты, секреты или внутренние ошибки;
- Patap и Driver получают отдельные публичные build outputs и host-aware правила Caddy.

## Auth boundary: текущий реализованный этап

В `server/auth/server.js` добавлены:

- доверенные публичные hosts `patap.eu`, `www.patap.eu`, `driver.patap.eu`;
- общая cookie `Domain=patap.eu` только для этих hosts;
- `https://driver.patap.eu` в CSRF allowlist;
- использование `X-Forwarded-Host` только от локального reverse proxy;
- удаление прежних host-only cookies перед выдачей общей cookie;
- удаление host-only и domain cookies при logout.

Автоматический auth-тест проверяет выдачу общей cookie, доступ к той же сессии с Driver host, разрешение доверенного Driver origin, отклонение постороннего origin и очистку обоих вариантов cookie.

Это ещё не означает полностью проверенный вход на публичном Driver: DNS, отдельный build и host routing уже созданы, но пользовательский Chrome пока не прошёл cross-subdomain сценарий из-за отрицательного DNS-кэша.

## Приёмочная матрица

Статусы: `PASS` означает реально выполненную проверку; `NOT_VERIFIED` означает реализованный, но ещё не пройденный целевой сценарий; `NOT_IMPLEMENTED` означает отсутствие функции.

| Сценарий | Текущий статус | Доказательство / следующий критерий |
|---|---|---|
| Текущий Patap stack | PASS | `status-patap-stack.cmd`: overall HEALTHY, 2026-07-13 |
| Текущая сборка и тесты до этапа | PASS | `npm run verify`: PlatformOS, 4 auth, 1 client test |
| Общая cookie Patap/Driver | PASS | isolated auth test `trusted Driver subdomain shares Patap cookies and passes CSRF checks` |
| Посторонний CSRF origin отклоняется | PASS | тот же isolated auth test |
| `driver.patap.eu` разрешается и отдаёт Driver | PASS | Cloudflare route/CNAME созданы; прямой публичный HTTPS-запрос: HTTP 200 |
| Отдельный Driver build и host routing | PASS | отдельный `var/build/driver`, validated Caddy matcher, публичный HTTPS 200 |
| Вход через существующий аккаунт в реальном Chrome | NOT_VERIFIED | Chrome после создания DNS всё ещё вернул `ERR_NAME_NOT_RESOLVED`; повторить после обновления кэша |
| Уникальный профиль и тип водителя | PASS | migration v2, API, UI и auth persistence/uniqueness test |
| GPS и управляемая видимость | NOT_VERIFIED | foundation и автоматизированная state-machine/API проверка существуют; реальное устройство и authenticated public E2E не проверены |
| Реальные маркеры второго пользователя | NOT_VERIFIED | API/marker reconciliation реализованы; нужен реальный сценарий двух аккаунтов/устройств |
| Реальный чат | NOT_IMPLEMENTED | нужны persistence, realtime и два аккаунта |
| Реальная half-duplex рация | NOT_IMPLEMENTED | нужны microphone flow, server lock и два устройства |
| Пользовательские парковки | NOT_IMPLEMENTED | нужны create/read/update/confirm и модерация |
| Друзья с подтверждением | NOT_IMPLEMENTED | нужны request/accept/reject и серверные права |
| Минимальные уведомления | NOT_IMPLEMENTED | нужны серверные события и persistence |
| Owner admin для V1-модулей | NOT_IMPLEMENTED | нужны Driver admin API/UI и role tests |
| Сообщества | POST_V1 | не показывать в V1 |
| Рейтинг | POST_V1 | не показывать до реальной реализации |

## Ограниченное исследование рынка

Проверенные источники и применимые выводы:

- Google Location Sharing: явный выбор получателя и срока, возможность остановить sharing — <https://support.google.com/maps/answer/15437054>.
- Waze: пользовательские места проходят проверку, отчёты имеют ограничения против спама, offline-отчёт отправляется после восстановления сети — <https://support.google.com/waze/answer/6262592>.
- Trucker Path: парковка показывается как `FULL`, `SOME`, `EMPTY` и обновляется водителями; отзывы также подтверждают риск ошибочных пользовательских статусов — <https://play.google.com/store/apps/details?id=com.sixdays.truckerpath>.
- Zello: PTT — выбрать канал, удерживать кнопку, говорить после сигнала, отпустить для завершения — <https://support.zello.com/zc/sending-push-to-talk-messages>.
- Zello channels: роли говорящих/слушателей и очередь сообщений между несколькими каналами — <https://zello.com/product/features/channels/>.
- Uber Driver: карта как операционный экран, четыре основных раздела, быстрый доступ к safety и inbox — <https://www.uber.com/us/en/drive/driver-app/>.
- Android background location ограничивает частоту фоновых обновлений; точность и батарея требуют явного компромисса — <https://developer.android.com/about/versions/oreo/background-location-limits>.
- Cloudflare Tunnel поддерживает несколько public hostnames и WebSockets — <https://developers.cloudflare.com/tunnel/routing/> и <https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/>.

Выводы исследования являются проектными ориентирами. Они не считаются уже реализованными функциями Driver.

## Исторический план до Driver shell и DP-002

Этот блок сохранён только для хронологии. Его пункты выполнены частично или устарели; актуальный recovery-план находится в `docs/DRIVER_PATAP_RECOVERY_2026-07-13.md`.

- `Permissions-Policy` текущего Caddy запрещает microphone и geolocation для всех hosts; Driver потребует отдельной host policy.
- Текущий CSP не разрешает внешнего картографического провайдера.
- Текущий build выпускает только Patap Lab.
- Текущий backend не содержит подтверждённого WebSocket/realtime слоя.
- Существующие активные host-only сессии требуют проверяемого переходного сценария к общей cookie.
- Нагрузка, поставщик карты, политика хранения аудио и точная модель realtime пока неизвестны.

Следующий ограниченный этап:

1. Выпустить отдельный Driver shell без неработающих функциональных кнопок.
2. Добавить отдельный build output и host-aware Caddy routing.
3. Добавить версионированную миграцию профиля Driver, связанную с `users.id`.
4. Реализовать и проверить вход существующей Patap-сессией в реальном браузере.
5. Только после прохождения auth/profile acceptance перейти к карте и GPS.
