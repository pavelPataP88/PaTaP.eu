# Block: auth-local

Status: active
Created: 2026-07-08

## Purpose

Локальный вход в Patap Lab без backend.

## User Flow

Пользователь может:

- зарегистрироваться;
- войти;
- восстановить пароль;
- выйти.

## Files

- `index.html` - формы входа, регистрации и восстановления.
- `app.js` - логика users/session в localStorage.
- `styles.css` - оформление auth screen.

## Data

```text
localStorage.patapLabUsers
localStorage.patapLabSession
```

## Limitations

Это не серверная авторизация. Аккаунт существует только в конкретном браузере.

Для входа с телефона и ноутбука под одним аккаунтом позже нужен backend.
