# Как опубликовать VoxelMotion на GitHub

Репозиторий проекта: [skzysz/VoxelMotion](https://github.com/skzysz/VoxelMotion). Готовые EXE размещаются отдельно в [Releases](https://github.com/skzysz/VoxelMotion/releases). Ниже сохранена инструкция для повторения публикации и следующих обновлений.

## 1. Создайте пустой репозиторий

Откройте [создание репозитория](https://github.com/new), укажите имя `VoxelMotion`. Для первого сохранения можно выбрать **Private**. При создании не добавляйте README, `.gitignore` или лицензию: README и правила исключения уже есть локально.

В проекте есть код прежнего приложения и включённые ресурсы Minecraft. Перед выбором Public проверьте права на их публичное распространение. Новая лицензия автоматически не назначена.

## 2. Подготовьте исходники

Откройте PowerShell в корне проекта, а не внутри `resources/app`:

```powershell
cd 'C:\.projects\FXstudio-Lite-Clone'
git init -b main
git add .
git status --short
```

В списке должны быть исходники, `package.json`, `package-lock.json`, документация и ресурсы. `.gitignore` исключает `node_modules`, `dist`, тестовые профили, временные установки, логи, результаты тестовых экспортов и локальные отчёты.

Создайте первый коммит:

```powershell
git commit -m 'Initial VoxelMotion 2.13.0'
```

Если Git попросит имя и email, задайте их для этого репозитория и повторите коммит:

```powershell
git config user.name 'YOUR_NAME'
git config user.email 'YOUR_GITHUB_EMAIL_OR_NOREPLY'
git commit -m 'Initial VoxelMotion 2.13.0'
```

Замените значения на свои. Git установлен в текущей системе; GitHub CLI для этих команд не нужен.

## 3. Отправьте проект

Замените `YOUR_LOGIN` на логин GitHub:

```powershell
git remote add origin https://github.com/YOUR_LOGIN/VoxelMotion.git
git push -u origin main
```

При запросе входа авторизуйтесь в GitHub через менеджер учётных данных Git. Не вставляйте токен в файлы проекта или URL репозитория. Если `origin` уже существует, проверьте `git remote -v` и при необходимости используйте `git remote set-url origin https://github.com/YOUR_LOGIN/VoxelMotion.git`.

Основа шагов: [официальная инструкция GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github?platform=windows).

## 4. Опубликуйте готовую программу

В репозитории откройте **Releases → Draft a new release**:

1. Создайте тег `v2.13.0` для ветки `main`.
2. Название релиза: `VoxelMotion 2.13.0`.
3. Прикрепите файлы из `FXstudio Lite/resources/app/dist/`:
   - `VoxelMotion-2.13.0-Setup.exe`;
   - `VoxelMotion-2.13.0-Portable.exe`;
   - `VoxelMotion-2.13.0-SHA256SUMS.txt`, если хотите приложить контрольные суммы.
   - `latest.yml` — обязателен для обновлений установленной программы;
   - `VoxelMotion-2.13.0-Setup.exe.blockmap` — файл штатного механизма обновлений.
4. Добавьте описание и нажмите **Publish release**.

EXE не добавляйте через `git add`: GitHub блокирует файлы больше 100 MiB в обычном Git, а эти сборки превышают лимит. Для распространения готовых программ используется Releases. Источники: [лимиты файлов](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), [создание релиза](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

`latest.yml` и `.blockmap` генерируются сборкой. Не редактируйте в них версию, имя установщика или контрольные суммы вручную. Тег релиза и версия установщика должны совпадать. Для первого перехода с 2.12.1 пользователи устанавливают новый Setup вручную; следующие версии получают обновления через приложение.

Пример описания релиза:

> VoxelMotion 2.13.0 — новое название редактора эффектов Minecraft. 188 эффектов, автосохранение и восстановление, личные подборки, инструменты слоёв и пресеты экспорта. Windows x64. Portable запускается без установки и Node.js. Экспорт видео — без звука. Установщик и EXE не имеют цифровой подписи издателя.

## 5. Следующие обновления

После изменения программы обновите версию, проверьте её и пересоберите:

```powershell
cd 'C:\.projects\FXstudio-Lite-Clone\FXstudio Lite\resources\app'
npm test
npm run dist
cd '..\..\..'
git add .
git commit -m 'Describe your changes'
git push
```

Затем создайте следующий релиз с новым тегом и новыми EXE. Не перезаписывайте опубликованные версии незаметно для пользователей.
