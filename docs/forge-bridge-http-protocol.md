# RadminCraft Forge Bridge Protocol

## Совместимость

Стабильный локальный HTTP-протокол отделяет Forge-мод от интерфейса и внутренней
архитектуры RadminCraft. Текущая версия:

```json
{ "major": 1, "minor": 1 }
```

- изменение `minor` только добавляет необязательные поля и не ломает старые JAR;
- изменение `major` означает несовместимость и требует обновления мода;
- неизвестные JSON-поля обе стороны обязаны игнорировать;
- мод использует только `http://127.0.0.1:18483`;
- изменяющие состояние Bridge-endpoints отклоняют запросы не с loopback;
- тело запроса ограничено Host, строки дополнительно нормализуются.

Мод не содержит продуктовой логики профилей, уведомлений, временного Host,
BlueMap или интерфейса. Он только передаёт события Minecraft и выполняет
типизированные команды.

## Надёжность доставки

- сетевой ввод-вывод никогда не выполняется в server tick thread;
- события помещаются в ограниченную очередь;
- при недоступном RadminCraft используется exponential backoff с jitter;
- каждое событие получает стабильный `eventId`, повторы безопасны;
- Host хранит исходящие команды до подтверждения или не более 10 минут;
- мод хранит последние выполненные command ID и не повторяет сообщение после
  перезапуска/повторной доставки;
- очередь ограничена, чтобы недоступный Host не мог исчерпать память сервера.

## Heartbeat

`POST /api/bridge/heartbeat`, каждые 5 секунд:

```json
{
  "protocolMajor": 1,
  "protocolMinor": 1,
  "bridgeVersion": "1.1.0",
  "minecraftVersion": "1.20.1",
  "forgeVersion": "47.4.17",
  "serverKind": "integrated",
  "serverId": "stable-local-id",
  "players": 4
}
```

Несовместимый `protocolMajor` получает HTTP `426`.

## Событие игрового чата

`POST /api/bridge/chat`

```json
{
  "eventId": "uuid",
  "serverId": "stable-world-id",
  "playerId": "minecraft-uuid",
  "player": "Steve",
  "text": "Привет из игры",
  "createdAt": 1785312000000
}
```

Сообщение `!radmincraft link 123456` обрабатывается как подтверждение привязки и
не публикуется в общий чат.

## Состояние игрока

`POST /api/bridge/player-status`

```json
{
  "eventId": "uuid",
  "serverId": "stable-world-id",
  "id": "minecraft-uuid",
  "name": "Steve",
  "inGame": true,
  "x": 120.5,
  "z": -44.0,
  "dimension": "minecraft:overworld"
}
```

Событие отправляется при входе/выходе и периодически обновляется для координат.

## Команды RadminCraft → Minecraft

`GET /api/bridge/commands?limit=50&serverId=stable-world-id`

```json
{
  "ok": true,
  "protocol": { "major": 1, "minor": 1 },
  "commands": [{
    "id": "message-uuid",
    "type": "chat.broadcast",
    "createdAt": 1785312000000,
    "payload": { "author": "Дед", "text": "Заходим в шахту" }
  }]
}
```

Версия 1.x определяет только `chat.broadcast`. Неизвестную команду мод не
исполняет и не подтверждает.

После успешного выполнения:

`POST /api/bridge/ack`

```json
{ "ids": ["message-uuid"] }
```

В Minecraft сообщение показывается как обычный текст RadminCraft, а не
исполняемая команда. Управляющие коды и опасное форматирование удаляются.

## Поддерживаемые сборки

Общее ядро протокола используется во всех адаптерах, но JAR отдельный:

- Forge 1.12.2;
- Forge 1.16.5;
- Forge 1.18.2;
- Forge 1.19.2;
- Forge 1.20.1.

Bridge не регистрирует блоки, предметы, сущности или обязательный сетевой канал.
Подключающимся игрокам он не требуется.
