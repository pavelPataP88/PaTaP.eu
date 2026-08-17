# Feature Blocks Registry

В этом проекте feature block = "сота".

Каждая сота имеет отдельную папку и `block.md`.

## Active blocks

| Block | Folder | Status | Description |
| --- | --- | --- | --- |
| Local Auth | `features/auth-local/` | active | Регистрация, вход, восстановление пароля, выход через localStorage. |
| Core Lab Shell | `features/core-lab/` | active | Главный экран лаборатории, навигация, общий layout. |
| Projects | `features/projects/` | active | Локальные карточки проектов/идей. |
| Library | `features/library/` | active | Локальные заметки и материалы. |
| Research | `features/research/` | active | Локальные темы исследований. |
| Settings | `features/settings/` | active | Имя пользователя и компактный режим. |

## Planned examples

Пока не создавать без отдельной задачи:

- Drivers
- Backend
- Minus Zero theory
- Public project dashboard

## Rule

Если добавляется новая вкладка, сначала создать:

```text
features/<new-block>/block.md
```

Потом менять код.
