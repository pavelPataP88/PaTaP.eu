# Block: settings

Status: active
Created: 2026-07-08

## Purpose

Настройки локального пользователя и интерфейса.

## User Flow

Пользователь может:

- изменить отображаемое имя;
- включить или выключить компактный режим.

## Files

- `index.html` - section `data-view="settings"`.
- `app.js` - обновление user.name и `patapLabSettings`.
- `styles.css` - compact mode и форма настроек.

## Data

```text
localStorage.patapLabUsers
localStorage.patapLabSettings
```
