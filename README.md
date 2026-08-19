# PATAP.EU

Локально размещаемая платформа с двумя веб-приложениями:

- **Patap Lab** — основной сайт: [https://patap.eu](https://patap.eu). Без входа доступна интерактивная витрина с демонстрационными данными.
- **Driver Patap** — приложение для водителей: [https://driver.patap.eu](https://driver.patap.eu). Без входа доступен безопасный просмотр карты, чата, контактов и профиля на демо-данных.

Проект работает на этом компьютере из папки `D:\WWW.PATAP.EU`. Внешний HTTPS-доступ обеспечивает Cloudflare Tunnel; открывать входящие порты на роутере не требуется.

## Быстрый запуск

Откройте PowerShell в папке проекта и выполните:

```powershell
.\start-patap-stack.cmd
.\status-patap-stack.cmd
```

Нормальный результат второй команды — `"overall": "HEALTHY"`.

Для остановки:

```powershell
.\stop-origin.cmd
powershell -ExecutionPolicy Bypass -File .\stop-backend.ps1
powershell -ExecutionPolicy Bypass -File .\stop-patap-tunnel.ps1
```

Подробные действия при неполадках находятся в [операционной инструкции](docs/RUNBOOK.md).

## Что умеют сайты

### Patap Lab

- открытый гостевой просмотр без личных данных, изменений и админ-доступа;
- регистрация и вход с серверной авторизацией;
- роли `User`, `Administrator` и единственный `Owner`;
- административная зона для Owner/Administrator;
- сброс пароля одноразовым токеном;
- локальные (в браузере) карточки проектов, заметки, исследования и настройки.

### Driver Patap

- открытый просмотр интерфейса на демонстрационных водителях и сообщениях;
- общий аккаунт с Patap Lab;
- профиль водителя, поиск и контакты;
- карта ближайших водителей и добровольная публикация GPS;
- общий и личный чат;
- прямая рация для подтверждённых контактов.

Для реальной карты, GPS, чата и рации требуется авторизованный пользователь с заполненным профилем водителя. В гостевом режиме GPS, реальные контакты, отправка сообщений и запись аудио отсутствуют. Публикация GPS выключена по умолчанию.

## Как это устроено

```text
Пользователь
  -> Cloudflare HTTPS
  -> Cloudflare Tunnel (cloudflared)
  -> Caddy, 127.0.0.1:8090
  -> Patap Lab:     var/build/dist
     Driver Patap:  var/build/driver
  -> API: Node.js, 127.0.0.1:8091
  -> SQLite:        data/auth/patap-auth.sqlite
```

Сборка всегда создаётся из исходников:

```powershell
npm run build
npm run verify
```

`npm run verify` проверяет сборку, ограничения на публикацию файлов, PlatformOS и тесты API/клиента. Для отдельного браузерного smoke-test используется `npm run test:browser`.

## Структура проекта

Фоновая картинка `assets/patap-lab-bg.png` опубликована вместе с исходниками, потому что используется в рабочем интерфейсе и не содержит пользовательских или секретных данных.

```text
index.html, app.js, styles.css   исходники Patap Lab
driver/                          исходники Driver Patap
server/auth/                     Node.js API и SQLite-авторизация
server/driver/, chat/, radio/    серверные части Driver
Caddyfile.tunnel                 веб-сервер и маршрутизация
scripts/                         сборка и проверки
data/                            база и конфигурация runtime
var/                             сборки, логи и PID-файлы runtime
docs/                            документация
```

## Безопасность и данные

- Пароли хешируются сервером через `scrypt`.
- Сессии используют `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- Изменяющие API-запросы защищены CSRF-токеном.
- Tunnel token находится вне репозитория: `%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt`.
- Не копируйте в репозиторий токены, ключи, пароли, `data/` или `var/`.

Резервная копия базы:

```powershell
npm run auth:backup
```

Восстановление базы — чувствительная операция; точная безопасная последовательность указана в [RUNBOOK](docs/RUNBOOK.md#восстановление-базы).

## Документация

- [Навигатор документации](docs/README.md)
- [Операционная инструкция](docs/RUNBOOK.md)
- [Текущий статус](docs/CURRENT_STATUS.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [Спецификация Driver Patap](docs/DRIVER_PATAP_V1.md)
