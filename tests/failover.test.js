'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  FAILOVER_TIMEOUT_MS,
  CANDIDATE_STEP_MS,
  cleanAddress,
  signDescriptor,
  verifyDescriptor,
  rankCandidates,
  promotionDelay,
  canPromote,
  mergeReplicatedMessages
} = require('../electron/failover');

test('Radmin addresses are normalized and non-Radmin addresses are rejected', () => {
  assert.equal(cleanAddress('::ffff:26.1.2.3'), '26.1.2.3:18483');
  assert.equal(cleanAddress('26.1.2.3:19000'), '26.1.2.3:19000');
  assert.equal(cleanAddress('192.168.1.2'), '');
});

test('candidate order is deterministic and ignores duplicate entries', () => {
  const now = 1_000_000;
  const ranked = rankCandidates([
    { deviceId: 'b', address: '26.0.0.2', seenAt: now - 100, revision: 8 },
    { deviceId: 'a', address: '26.0.0.1', seenAt: now - 50, revision: 8 },
    { deviceId: 'b', address: '26.0.0.2', seenAt: now - 500, revision: 7 }
  ]);
  assert.deepEqual(ranked.map(item => item.deviceId), ['a', 'b']);
});

test('signed primary descriptor detects tampering', () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const signed = signDescriptor({
    communityId: crypto.randomUUID(),
    primaryDeviceId: 'primary',
    primaryHostAddress: '26.1.2.3:18483',
    term: 1,
    issuedAt: Date.now(),
    candidates: [{ deviceId: 'candidate', address: '26.1.2.4:18483', seenAt: Date.now(), revision: 5 }]
  }, privateKey, publicKey);
  assert.equal(verifyDescriptor(signed), true);
  assert.equal(verifyDescriptor({ ...signed, term: 2 }), false);
});

test('candidates promote in ordered time slots', () => {
  const now = Date.now();
  const candidates = [
    { deviceId: 'first', address: '26.0.0.1', seenAt: now, revision: 2 },
    { deviceId: 'second', address: '26.0.0.2', seenAt: now, revision: 1 }
  ];
  assert.equal(promotionDelay(candidates, 'first'), FAILOVER_TIMEOUT_MS);
  assert.equal(promotionDelay(candidates, 'second'), FAILOVER_TIMEOUT_MS + CANDIDATE_STEP_MS);
  assert.equal(canPromote({ candidates, deviceId: 'first', failureSince: now, now: now + FAILOVER_TIMEOUT_MS - 1 }), false);
  assert.equal(canPromote({ candidates, deviceId: 'first', failureSince: now, now: now + FAILOVER_TIMEOUT_MS }), true);
});

test('recovery merges new messages, profile changes and deletion tombstones', () => {
  const old = ['a', 'Петя', 'app', 'старое', '10:00', null, 'one', 'device'];
  const renamed = ['b', 'Тролль', 'app', 'старое', '10:00', null, 'one', 'device'];
  const added = ['c', 'Друг', 'app', 'новое', '10:01', null, 'two', 'friend'];
  assert.deepEqual(
    mergeReplicatedMessages({ current: [old], incoming: [renamed, added], deletedIds: ['two'] }),
    [renamed]
  );
  assert.deepEqual(
    mergeReplicatedMessages({ current: [old], incoming: [added], currentClearAt: 10, incomingClearAt: 20 }),
    [added]
  );
});
