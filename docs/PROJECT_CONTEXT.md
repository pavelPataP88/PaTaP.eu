# Patap Lab Project Context

Этот документ нужен, чтобы новый чат быстро восстановил контекст проекта.

## Цель

Развивать сайт Patap Lab на домене `patap.eu`. Сервером остаётся ноутбук владельца, рабочая папка:

```text
D:\WWW.PATAP.EU
```

Не использовать Cloudflare Pages как основной вариант, не покупать хостинг, не открывать порты T-Mobile напрямую.

## Текущий Путь Публикации

```text
https://patap.eu
  -> Cloudflare HTTPS
  -> Cloudflare Tunnel patap-lab
  -> http://127.0.0.1:8090 on laptop
  -> Caddy
  -> D:\WWW.PATAP.EU\var\build\dist
```

`https://www.patap.eu` настроен так же.

`https://driver.patap.eu` проходит через тот же Tunnel и Caddy, но получает отдельную сборку `var/build/driver`; его `/api/*` использует общий backend и общую Patap-сессию.

Cloudflare DNS использует tunnel records для:

```text
patap.eu
www.patap.eu
driver.patap.eu
```

OVH остаётся регистратором. Nameservers делегированы на Cloudflare:

```text
anita.ns.cloudflare.com
maxim.ns.cloudflare.com
```

## Runtime

Текущий рабочий UI пока legacy-root:

```text
index.html
styles.css
app.js
assets/patap-lab-bg.png
```

Публичная сборка:

```text
var/build/dist/
```

Caddy не должен отдавать весь корень проекта.

## Auth

Авторизация серверная:

- аккаунты и роли хранятся в локальной SQLite-базе на ноутбуке PATAP LAB;
- пароли хешируются на сервере с помощью `scrypt`;
- сессия хранится в защищённой cookie, а изменяющие запросы требуют CSRF-токен;
- публичная регистрация создаёт только роль `User`;
- роли `Owner` и `Administrator` управляются через защищённую административную зону;
- email-подтверждение пока не включено;
- восстановление пароля выполняется одноразовым токеном, который создаёт Owner или Administrator;
- Administrator не может отключать Owner, завершать его сессии или создавать для него reset token.

Проекты, заметки, исследования и пользовательские настройки пока хранятся в браузере, но разделены по стабильному `user.id`.

## PlatformOS

Архитектурная цель: модульная платформа `PlatformOS`.

Правила:

- `core/` содержит только инфраструктуру;
- `services/` содержит общие сервисы, включая будущий AI;
- AI является сервисом, не модулем;
- `modules/` содержит независимые модули;
- все модули регистрируются только через `system/registry.json`;
- новый модуль добавляется через папку и registry entry;
- core не должен меняться при добавлении обычного модуля.

Реальность на 2026-07-10: PlatformOS runtime есть и тестируется, но пользовательский сайт ещё работает из root UI и только собирается в dist.

## Feature Blocks

Новые вкладки и крупные функции добавляются как отдельные блоки:

```text
features/<block-name>/block.md
modules/<module-name>/
```

При добавлении блока обновлять:

- `system/registry.json`, если это новый модуль;
- `docs/CHANGELOG.md`;
- `features/README.md`;
- нужные файлы UI или модуля.

## Секреты

Не хранить и не публиковать:

- `*.token`
- `*.secret`
- `.cloudflared*`
- пароли
- ключи

Cloudflare token лежит вне проекта:

```text
%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt
```
