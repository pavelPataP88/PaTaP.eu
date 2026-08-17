# Cloudflare Tunnel

Активная схема публикации Patap Lab. Cloudflare Pages не используется, платный хостинг не используется, файлы сайта остаются на ноутбуке.

## Схема

```text
Visitor
  -> https://patap.eu
  -> Cloudflare edge HTTPS
  -> Cloudflare Tunnel outbound connection
  -> this laptop
  -> Caddy http://127.0.0.1:8090
  -> D:\WWW.PATAP.EU\var\build\dist
```

Порты 80 и 443 через T-Mobile открывать не нужно.

## Текущее Состояние Cloudflare

```text
Tunnel name: patap-lab
Tunnel ID: 3fcb984b-9a1e-4874-b98c-39d73da50c72
Origin: http://127.0.0.1:8090
Routes: patap.eu, www.patap.eu, driver.patap.eu
```

DNS records в Cloudflare:

```text
patap.eu      Tunnel patap-lab  Proxied
www.patap.eu  Tunnel patap-lab  Proxied
```

Nameservers у домена:

```text
anita.ns.cloudflare.com
maxim.ns.cloudflare.com
```

## Запуск

```powershell
cd D:\WWW.PATAP.EU
.\start-origin.cmd
powershell -ExecutionPolicy Bypass -File .\start-patap-tunnel.ps1
```

## Token

Token хранится вне web root:

```text
%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt
```

Tunnel запускается с `--token-file`, а не с raw token в командной строке.

## Проверка

```powershell
Invoke-WebRequest -Uri https://patap.eu -UseBasicParsing
Invoke-WebRequest -Uri https://www.patap.eu -UseBasicParsing
Invoke-WebRequest -Uri https://patap.eu/system/registry.json -UseBasicParsing
```

Ожидается:

- `patap.eu` -> `200`;
- `www.patap.eu` -> `200`;
- `/system/registry.json` -> `404`.

## Backend Позже

Backend можно добавить позже на этом же ноутбуке отдельным локальным сервисом и новым hostname, например:

```text
api.patap.eu -> http://127.0.0.1:3000
```

Файлы текущего сайта при этом остаются локально.
