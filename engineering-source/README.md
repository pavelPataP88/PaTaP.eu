# Полный инженерный исходник

В этой папке лежат части одного ZIP-архива с исходным кодом: сервер, сайты, тесты, документы и настройки запуска. Из набора исключены секреты, пользовательские данные, журналы, runtime-файлы и изображения.

Собрать архив в Windows (в командной строке из этой папки):

```bat
copy /b PaTaP.eu-source.part001+PaTaP.eu-source.part002+PaTaP.eu-source.part003+PaTaP.eu-source.part004+PaTaP.eu-source.part005+PaTaP.eu-source.part006+PaTaP.eu-source.part007+PaTaP.eu-source.part008+PaTaP.eu-source.part009+PaTaP.eu-source.part010 PaTaP.eu-source.zip
```

После этого распакуйте `PaTaP.eu-source.zip` обычным архиватором или командой PowerShell:

```powershell
Expand-Archive -LiteralPath .\PaTaP.eu-source.zip -DestinationPath .\PaTaP.eu-source
```

Для начала анализа откройте в распакованной папке `docs/AI_REVIEW_BRIEF.md`.
