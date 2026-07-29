# Проверка релиза 0.4.0

Дата подготовки: 30 июля 2026.

## Автоматически проверено

- [x] `npm ci` восстанавливает проект по `package-lock.json`;
- [x] `npm audit` — 0 известных уязвимостей;
- [x] `npm run check` — синтаксис main, preload и renderer корректен;
- [x] `npm test` — 29 из 29 тестов пройдены;
- [x] electron-builder 26.15.3 собрал Windows x64 NSIS;
- [x] упакованный `RadminCraft.exe` запущен с чистым временным профилем;
- [x] renderer завершил smoke-test с кодом 0;
- [x] `latest.yml` содержит версию 0.4.0;
- [x] `app-update.yml` указывает `arbuziksmiley/RadminCraft`;
- [x] в resources находятся пять Forge Bridge JAR 1.1.0;
- [x] SHA-256 всех Bridge JAR совпадает с `forge-bridge/dist/SHA256SUMS.txt`;
- [x] 150 аватаров присутствуют и не имеют одинаковых SHA-256;
- [x] 50 статичных стикеров присутствуют;
- [x] HTML/CSS не ссылаются на отсутствующие локальные файлы;
- [x] ICO содержит 16, 24, 32, 48, 64, 128 и 256 px;
- [x] иконка извлекается из EXE и установщика;
- [x] ProductName, FileDescription и InternalName равны `RadminCraft`.

## Артефакты

- `release/RadminCraft-Setup-0.4.0.exe`;
- `release/RadminCraft-Setup-0.4.0.exe.blockmap`;
- `release/latest.yml`;
- `release/SHA256SUMS.txt`;
- `release/win-unpacked/RadminCraft.exe`.

SHA-256 установщика:

`0ABFA65F7684C40935FB07C1495EC1CDAEFD1D13B363AE47AC8FB4D3D8893448`

## Что нельзя честно проверить на одном компьютере

- [ ] Host ↔ client на двух Windows-компьютерах через Radmin VPN;
- [ ] реальный WebRTC-разговор с разными аудиоустройствами;
- [ ] выбор временного Host и возврат основного;
- [ ] Bridge на каждой из пяти версий Forge;
- [ ] BlueMap на реальном сервере;
- [ ] автообновление 0.4.0 → 0.4.1 из опубликованного GitHub Release;
- [ ] Windows 11 (сборка создана на Windows 10).

Эти пункты являются ручным beta-тестом, а не причиной объявлять проверенные
локальные функции нерабочими.

## Известное предупреждение

Установщик не имеет коммерческой цифровой подписи (`NotSigned`). До приобретения
Code Signing Windows SmartScreen может показывать «неизвестный издатель».
