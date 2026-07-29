# Публикация RadminCraft через GitHub Releases

Основной репозиторий: `https://github.com/arbuziksmiley/RadminCraft`.

## Что хранится в Git

В репозиторий входят исходники `electron/`, `src/`, `forge-bridge/`, `tests/`, `tools/`, документация, `package.json` и `package-lock.json`.

Не коммитятся `node_modules/`, `release/`, `tmp/`, Gradle-кэши и пользовательские данные. Готовый установщик прикрепляется к GitHub Release, а не кладётся в ветку.

## Первый push

```powershell
git init
git branch -M main
git add .
git status
git commit -m "Release RadminCraft 0.4.0"
git remote add origin https://github.com/arbuziksmiley/RadminCraft.git
git push -u origin main
```

Перед `git commit` внимательно проверить `git status`: там не должно быть `node_modules`, `release`, `tmp` или файлов из `%APPDATA%`.

## Локальная проверка релиза

```powershell
npm ci
npm run check
npm test
npm run dist
```

В `release/` должны появиться:

- `RadminCraft-Setup-0.4.0.exe`;
- `RadminCraft-Setup-0.4.0.exe.blockmap`;
- `latest.yml`;
- `SHA256SUMS.txt`;
- `win-unpacked/` для локальной диагностики.

Для ручного GitHub Release загружаются первые четыре файла. `win-unpacked` загружать не нужно.

## Автоматическая публикация

Workflow `.github/workflows/release.yml` запускается по тегу `v*`, повторяет проверки, собирает Windows x64 NSIS, рассчитывает SHA-256 и публикует четыре файла через стандартный `GITHUB_TOKEN`.

Для новой версии:

```powershell
npm version 0.4.1 --no-git-tag-version
npm run check
npm test
git add package.json package-lock.json
git commit -m "Release 0.4.1"
git tag v0.4.1
git push origin main
git push origin v0.4.1
```

В GitHub открыть **Actions** и дождаться зелёного завершения `Release Windows installer`. Затем открыть **Releases** и проверить, что релиз опубликован, не является Draft и содержит EXE, blockmap и `latest.yml`.

## Как проверить автообновление

Первый релиз не может обновиться «сам на себя». Полная проверка выполняется так:

1. установить опубликованный `0.4.0`;
2. изменить версию проекта на `0.4.1`;
3. опубликовать тег `v0.4.1`;
4. запустить установленный `0.4.0`;
5. дождаться уведомления в колокольчике или перезапустить приложение;
6. нажать «Скачать обновление» и затем «Перезапустить и установить»;
7. проверить версию и сохранность `%APPDATA%\radmincraft`.

## SHA-256

Перед публикацией локального файла:

```powershell
Get-FileHash .\release\RadminCraft-Setup-0.4.0.exe -Algorithm SHA256
```

Хэш вставляется в описание Release. Пользователь сможет повторить ту же команду.

## Важные ограничения

- репозиторий для публичного автообновления должен быть публичным;
- Draft-релиз клиент не видит;
- нельзя удалять `latest.yml` или `.blockmap`;
- версия тега и версия `package.json` должны совпадать;
- установщик пока не подписан сертификатом, поэтому возможен SmartScreen;
- до выбора лицензии не добавлять случайный `LICENSE`.
