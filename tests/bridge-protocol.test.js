'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BRIDGE_PROTOCOL, isLoopbackAddress, normalizeHeartbeat,
  normalizeGameChat, commandFromMessage, BridgeOutbox
} = require('../electron/bridge-protocol');

test('bridge protocol is versioned and accepts only loopback transport', () => {
  assert.deepEqual(BRIDGE_PROTOCOL, { major: 1, minor: 1 });
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('26.1.2.3'), false);
});

test('bridge payloads are bounded and normalized', () => {
  const heartbeat = normalizeHeartbeat({ protocolMajor: 1, players: 99999, serverKind: 'integrated' });
  assert.equal(heartbeat.players, 1000);
  assert.equal(heartbeat.serverKind, 'integrated');
  const chat = normalizeGameChat({ player: ' Steve ', text: `hello\u0000${'x'.repeat(700)}` });
  assert.equal(chat.player, 'Steve');
  assert.equal(chat.text.includes('\u0000'), false);
  assert.equal(chat.text.length, 600);
});

test('only ordinary RadminCraft text becomes a Minecraft command', () => {
  assert.equal(commandFromMessage(['a', 'Alex', 'sticker', 'mc-01']), null);
  assert.equal(commandFromMessage(['a', 'Steve', 'game', 'echo']), null);
  const command = commandFromMessage(['a', 'Alex', 'app', 'Привет', '12:00', null, 'message-1'], 123);
  assert.deepEqual(command, { id: 'message-1', type: 'chat.broadcast', createdAt: 123, payload: { author: 'Alex', text: 'Привет' } });
});

test('bridge outbox acknowledges, expires and bounds commands', () => {
  const outbox = new BridgeOutbox({ max: 2, ttl: 100 });
  outbox.enqueue({ id: '1', type: 'chat.broadcast', createdAt: 0 }, 0);
  outbox.enqueue({ id: '2', type: 'chat.broadcast', createdAt: 1 }, 1);
  outbox.enqueue({ id: '3', type: 'chat.broadcast', createdAt: 2 }, 2);
  assert.deepEqual(outbox.list(50, 2).map(item => item.id), ['2', '3']);
  assert.equal(outbox.acknowledge(['2']), 1);
  assert.deepEqual(outbox.list(50, 200), []);
});
