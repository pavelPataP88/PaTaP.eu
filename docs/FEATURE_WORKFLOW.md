# Feature Block Workflow

В этом проекте новая "сота" называется `feature block`.

Feature block - это отдельный смысловой блок сайта: вкладка, раздел, модуль, панель, backend endpoint или большая функция.

## Правило

Любой новый крупный блок должен иметь свою папку:

```text
features/<block-name>/
```

Внутри обязательно:

```text
features/<block-name>/block.md
```

## Шаблон добавления новой вкладки

Например пользователь просит: "Добавь вкладку Водители".

Порядок:

1. Создать папку:

```text
features/drivers/
```

2. Создать описание:

```text
features/drivers/block.md
```

3. Добавить вкладку в `index.html`.
4. Добавить стили в `styles.css`.
5. Добавить поведение в `app.js`.
6. Обновить `features/README.md`.
7. Добавить запись в `docs/CHANGELOG.md`.
8. Проверить локально `http://127.0.0.1:8090`.

## Что писать в block.md

```md
# Block: drivers

Status: planned | active | paused | archived
Created: YYYY-MM-DD

## Purpose

Что делает блок.

## User Flow

Как пользователь работает с блоком.

## Files

- index.html
- styles.css
- app.js
- assets/...

## Data

Какие localStorage ключи или backend endpoints использует.

## Notes

Ограничения и следующие шаги.
```

## Статусы

- `planned` - запланировано, ещё не реализовано.
- `active` - работает в сайте.
- `paused` - временно остановлено.
- `archived` - больше не используется.

## Не смешивать блоки

Если новый раздел большой, не добавлять его как случайный кусок в существующий код без папки и документа.

Сначала папка и документ, потом код.
