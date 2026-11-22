# VoxelMotion

Редактор эффектов и анимации Minecraft для Windows x64. Версия **2.12.1**.

188 эффектов, сцены и слои, автосохранение с восстановлением, личные подборки, варианты эффектов и пресеты экспорта. Форматы: MP4, прозрачный WebM, GIF, PNG и ZIP с PNG-кадрами. Видео экспортируется без звука.

## Запуск

Скачать готовую программу: [GitHub Releases](https://github.com/skzysz/VoxelMotion/releases).

Готовые приложения находятся в `FXstudio Lite/resources/app/dist/`:

- `VoxelMotion-2.12.1-Portable.exe` — без установки и Node.js.
- `VoxelMotion-2.12.1-Setup.exe` — установка с ярлыками.

В опубликованном репозитории готовые EXE следует скачивать со страницы **Releases**, поскольку папка `dist` исключена из Git.

## Разработка

Требуется Node.js 22.12+.

```powershell
cd 'FXstudio Lite/resources/app'
npm ci
npm start
```

```powershell
npm test
npm run verify:recovery
npm run verify:export
npm run verify:workspace
npm run dist
```

Проверки интерфейса запускайте последовательно: они используют общий отдельный тестовый профиль и локальный порт 9555.

## Документация

- [Быстрый старт](FXstudio%20Lite/docs/ru/QUICKSTART.md)
- [Функции и проверки](FXstudio%20Lite/docs/ru/README.md)
- [Публикация на GitHub](GITHUB.md)

Папка исходников пока сохраняет прежнее имя `FXstudio Lite`. Имя приложения, интерфейс, значок и новые сборки — **VoxelMotion**. Внутренний профиль данных и идентификатор обновления сохранены для совместимости с существующими проектами.

![VoxelMotion](FXstudio%20Lite/docs/ru/screenshots/branding/catalog.png)
