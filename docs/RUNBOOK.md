# Операционная инструкция PATAP.EU

Эта инструкция предназначена для запуска и восстановления сайтов на компьютере, где находится `D:\WWW.PATAP.EU`.

## Нормальное состояние

Для работы публичных сайтов одновременно нужны три процесса:

| Компонент | Назначение | Проверка |
| --- | --- | --- |
| Node.js backend | авторизация и API | `http://127.0.0.1:8091/api/health` |
| Caddy | локальный веб-сервер | `http://127.0.0.1:8090/` |
| cloudflared | соединение с Cloudflare | процесс `cloudflared.exe` |

`patap.eu`, `www.patap.eu` и `driver.patap.eu` используют один Tunnel. Caddy выдаёт разные сборки по hostname.

## Запуск

Обычный запуск всего стека:

```powershell
cd D:\WWW.PATAP.EU
.\start-patap-stack.cmd
```

Скрипт запускает backend, пересобирает оба фронтенда, запускает Caddy и поднимает Cloudflare Tunnel. Повторный запуск безопасен: действующие процессы не дублируются.

Запуск по частям нужен только для диагностики:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-backend.ps1
.\start-origin.cmd
powershell -ExecutionPolicy Bypass -File .\start-patap-tunnel.ps1
```

## Проверка после запуска

```powershell
.\status-patap-stack.cmd
```

Ожидается `"overall": "HEALTHY"`. В отчёте должны быть `PASS` для:

- `local-site` и `auth-backend`;
- `caddy-process`, `caddy-origin` и `patap-tunnel`;
- `public-site`, `public-api-health`;
- редиректов HTTP → HTTPS и `www` → основному домену.

Дополнительно можно открыть в браузере:

```text
https://patap.eu
https://driver.patap.eu
```

## Если сайт не открывается

### Cloudflare показывает Error 1033

Это означает, что Cloudflare не видит активный Tunnel. На компьютере выполните:

```powershell
cd D:\WWW.PATAP.EU
powershell -ExecutionPolicy Bypass -File .\start-patap-tunnel.ps1
.\status-patap-stack.cmd
```

Проверьте наличие token-файла, не раскрывая его содержимое:

```powershell
Test-Path "$env:LOCALAPPDATA\PatapLab\cloudflared\patap-lab-token.txt"
```

Если файл существует, а Tunnel не стартует, посмотрите конец журнала:

```powershell
Get-Content .\var\logs\patap-lab-tunnel.err.log -Tail 100
```

### Локальный сайт на `8090` не отвечает

Запустите Caddy и проверьте его журнал:

```powershell
cd D:\WWW.PATAP.EU
.\start-origin.cmd
Get-Content .\var\logs\patap-lab-caddy.err.log -Tail 100
```

Конфигурацию можно проверить без запуска сервера:

```powershell
caddy validate --config .\Caddyfile.tunnel --adapter caddyfile
```

### API или вход не работают

```powershell
cd D:\WWW.PATAP.EU
powershell -ExecutionPolicy Bypass -File .\start-backend.ps1
Invoke-WebRequest http://127.0.0.1:8091/api/health -UseBasicParsing
Get-Content .\var\logs\patap-auth-backend.err.log -Tail 100
```

Backend имеет собственный supervisor и перезапускается при аварийной остановке.

## Остановка

Останавливайте только когда сайты действительно нужно выключить:

```powershell
cd D:\WWW.PATAP.EU
.\stop-origin.cmd
powershell -ExecutionPolicy Bypass -File .\stop-backend.ps1
powershell -ExecutionPolicy Bypass -File .\stop-patap-tunnel.ps1
```

## Сборка и тесты

```powershell
cd D:\WWW.PATAP.EU
npm run build
npm run verify
npm run test:browser
```

`verify` — основной набор проверок исходников, сборок, API и клиентских сценариев. `test:browser` отдельно проверяет основной сайт в браузере и требует доступного `https://patap.eu`.

## Логи

| Файл | Содержимое |
| --- | --- |
| `var/logs/patap-auth-supervisor.log` | события supervisor backend |
| `var/logs/patap-auth-backend.log` | стандартный вывод API |
| `var/logs/patap-auth-backend.err.log` | ошибки API |
| `var/logs/patap-lab-caddy.err.log` | журнал Caddy |
| `var/logs/patap-lab-tunnel.err.log` | журнал Cloudflare Tunnel |

## Автозапуск

Автозапуск установлен в папку Startup текущего пользователя:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Patap Lab Stack.cmd
```

Его можно переустановить:

```powershell
.\install-autostart.cmd
```

Важно: Startup запускается только после интерактивного входа этого пользователя в Windows. После перезагрузки без входа публичный сайт не будет доступен. Caddy и cloudflared не имеют отдельного supervisor; если один из них завершился, запустите `start-patap-stack.cmd` и проверьте статус.

## Резервное копирование

Создание резервной копии SQLite:

```powershell
npm run auth:backup
```

### Восстановление базы

1. Остановите backend.
2. Укажите конкретный файл резервной копии.
3. Выполните восстановление и затем снова запустите backend.

```powershell
powershell -ExecutionPolicy Bypass -File .\stop-backend.ps1
$env:PATAP_RESTORE_CONFIRM = "YES"
npm run auth:restore -- D:\WWW.PATAP.EU\data\auth\backups\<backup-file>.sqlite
Remove-Item Env:PATAP_RESTORE_CONFIRM
powershell -ExecutionPolicy Bypass -File .\start-backend.ps1
```

Скрипт восстановления проверяет целостность базы и сохраняет прежнюю копию рядом с суффиксом `.before-restore-...`.

