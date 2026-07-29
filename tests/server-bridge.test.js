'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseServerLogLine, parseBlueMapPlayers, nicknameMatches, parseMinecraftLinkMessage, repairMinecraftText } = require('../electron/server-bridge');

test('parses chat from a Forge server line', () => {
  const r = parseServerLogLine('[12:30:15] [Server thread/INFO] [minecraft/DedicatedServer]: <Nagibator> всем привет');
  assert.deepEqual(r, { type: 'chat', name: 'Nagibator', text: 'всем привет' });
});

test('parses chat without the [minecraft/…] segment', () => {
  const r = parseServerLogLine('[12:30:15] [Server thread/INFO]: <Masha> hi there');
  assert.deepEqual(r, { type: 'chat', name: 'Masha', text: 'hi there' });
});

test('strips the [Not Secure] chat prefix', () => {
  const r = parseServerLogLine('[12:30:15] [Server thread/INFO]: [Not Secure] <Vlad> тест');
  assert.deepEqual(r, { type: 'chat', name: 'Vlad', text: 'тест' });
});

test('parses chat written by the integrated Open-to-LAN server', () => {
  const r = parseServerLogLine('[12:30:15] [Render thread/INFO] [minecraft/ChatComponent]: [CHAT] <Nagibator> привет из LAN');
  assert.deepEqual(r, { type: 'chat', name: 'Nagibator', text: 'привет из LAN' });
});

test('repairs UTF-8 text mangled through a Windows CP1251 console', () => {
  assert.equal(repairMinecraftText('РџСЂРёРІРµС‚, РјРёСЂ!'), 'Привет, мир!');
  assert.equal(repairMinecraftText('Обычный русский текст'), 'Обычный русский текст');
  assert.equal(repairMinecraftText('English text'), 'English text');
});

test('a chat message that mentions "joined the game" is still chat, not an event', () => {
  const r = parseServerLogLine('[12:30:15] [Server thread/INFO]: <Alex> Masha joined the game lol');
  assert.deepEqual(r, { type: 'chat', name: 'Alex', text: 'Masha joined the game lol' });
});

test('parses join and leave events', () => {
  assert.deepEqual(parseServerLogLine('[12:30:20] [Server thread/INFO] [minecraft/MinecraftServer]: Masha joined the game'), { type: 'join', name: 'Masha' });
  assert.deepEqual(parseServerLogLine('[12:31:02] [Server thread/INFO]: Masha left the game'), { type: 'leave', name: 'Masha' });
});

test('ignores commands, deaths, advancements and server noise', () => {
  assert.equal(parseServerLogLine('[12:30:15] [Server thread/INFO]: Nagibator issued server command: /tp'), null);
  assert.equal(parseServerLogLine('[12:30:15] [Server thread/INFO]: Masha was slain by Zombie'), null);
  assert.equal(parseServerLogLine('[12:30:15] [Server thread/INFO]: Vlad has made the advancement [Stone Age]'), null);
  assert.equal(parseServerLogLine('[12:30:00] [main/INFO]: Loading libraries'), null);
  assert.equal(parseServerLogLine(''), null);
  assert.equal(parseServerLogLine('garbage without prefix'), null);
});

test('does not treat a long fake name as a join event', () => {
  // 20 chars is not a valid Minecraft name, so this is not a join event.
  assert.equal(parseServerLogLine('[12:30:15] [Server thread/INFO]: ThisIsAWayTooLongName joined the game'), null);
});

test('parseBlueMapPlayers normalizes rows and skips junk', () => {
  const players = parseBlueMapPlayers({ players: [
    { uuid: 'u1', name: 'Masha', position: { x: 100.7, y: 64, z: -200.2 }, foreign: false },
    { uuid: 'u2', name: 'Vlad', pos: { x: 5, z: 9 }, world: 'minecraft:the_nether', foreign: true },
    { garbage: true },
    null
  ]});
  assert.equal(players.length, 2);
  assert.deepEqual(players[0], { uuid: 'u1', name: 'Masha', x: 100.7, z: -200.2, dimension: 'minecraft:overworld', foreign: false });
  assert.equal(players[1].dimension, 'minecraft:the_nether');
  assert.equal(players[1].foreign, true);
});

test('parseBlueMapPlayers tolerates a missing/empty payload', () => {
  assert.deepEqual(parseBlueMapPlayers(null), []);
  assert.deepEqual(parseBlueMapPlayers({}), []);
  assert.deepEqual(parseBlueMapPlayers({ players: 'nope' }), []);
});

test('nicknameMatches is case-insensitive and rejects empty', () => {
  assert.equal(nicknameMatches('Nagibator', 'nagibator'), true);
  assert.equal(nicknameMatches('  Masha ', 'masha'), true);
  assert.equal(nicknameMatches('', 'anything'), false);
  assert.equal(nicknameMatches('Vlad', 'Alex'), false);
});

test('parses only the safe plain-chat Minecraft link challenge', () => {
  assert.equal(parseMinecraftLinkMessage('!radmincraft link 496985'), '496985');
  assert.equal(parseMinecraftLinkMessage('  !RADMINCRAFT   link   000042  '), '000042');
  assert.equal(parseMinecraftLinkMessage('/radmincraft link 496985'), '');
  assert.equal(parseMinecraftLinkMessage('!radmincraft link 123'), '');
  assert.equal(parseMinecraftLinkMessage('hello !radmincraft link 496985'), '');
});
