'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROTOCOL_VERSION,
  HOST_PORT,
  normalizeDisplayName,
  normalizeAvatarId,
  hostUrl,
  parseHostTarget,
  mentionsNick,
  diagnosticsSummary
} = require('../electron/protocol');

test('constants', () => {
  assert.equal(HOST_PORT, 18483);
  assert.equal(typeof PROTOCOL_VERSION, 'number');
});

test('normalizeDisplayName trims, collapses spaces and caps at 20', () => {
  assert.equal(normalizeDisplayName('  Angel   ochek  '), 'Angel ochek');
  assert.equal(normalizeDisplayName('x'.repeat(30)).length, 20);
  assert.equal(normalizeDisplayName(null), '');
  assert.equal(normalizeDisplayName(undefined), '');
});

test('normalizeAvatarId accepts only head-000..head-149', () => {
  assert.equal(normalizeAvatarId('head-000'), 'head-000');
  assert.equal(normalizeAvatarId('head-149'), 'head-149');
  assert.equal(normalizeAvatarId('head-150'), 'head-000'); // out of range
  assert.equal(normalizeAvatarId('head-99'), 'head-000');  // wrong digit count
  assert.equal(normalizeAvatarId('evil.png'), 'head-000');
  assert.equal(normalizeAvatarId(''), 'head-000');
});

test('hostUrl adds scheme and strips trailing slash', () => {
  assert.equal(hostUrl('26.1.2.3:18483'), 'http://26.1.2.3:18483');
  assert.equal(hostUrl('http://26.1.2.3:18483/'), 'http://26.1.2.3:18483');
  assert.equal(hostUrl('  26.1.2.3  '), 'http://26.1.2.3');
});

test('parseHostTarget splits hostname and port with default fallback', () => {
  assert.deepEqual(parseHostTarget('26.1.2.3:18483'), { hostname: '26.1.2.3', port: 18483 });
  assert.deepEqual(parseHostTarget('26.1.2.3'), { hostname: '26.1.2.3', port: HOST_PORT });
  assert.deepEqual(parseHostTarget('http://26.1.2.3:9000/'), { hostname: '26.1.2.3', port: 9000 });
  assert.equal(parseHostTarget('26.9.9.9', 12345).port, 12345);
});

test('mentionsNick detects @mentions and ignores near-misses', () => {
  assert.equal(mentionsNick('@RamazanTM идёшь в шахту?', 'RamazanTM'), true);
  assert.equal(mentionsNick('привет @ramazantm', 'RamazanTM'), true); // case-insensitive
  assert.equal(mentionsNick('спроси у @RamazanTM2', 'RamazanTM'), false); // longer nick
  assert.equal(mentionsNick('RamazanTM без собаки', 'RamazanTM'), false);
  assert.equal(mentionsNick('@Alex', 'RamazanTM'), false);
  assert.equal(mentionsNick('любой текст', ''), false);
  assert.equal(mentionsNick('@a.b(c)', 'a.b(c)'), true); // regex chars escaped
  // Cyrillic nicknames: \b is ASCII-only and would never match these.
  assert.equal(mentionsNick('привет @Нагибатор как дела', 'Нагибатор'), true);
  assert.equal(mentionsNick('@Нагибатор', 'Нагибатор'), true);
  assert.equal(mentionsNick('@Нагибаторище', 'Нагибатор'), false);
  assert.equal(mentionsNick('@Ангелочек!', 'Ангелочек'), true);
  assert.equal(mentionsNick('@all, собираемся в голосовом', 'Ангелочек'), true);
  assert.equal(mentionsNick('Внимание: @ALL!', 'RamazanTM'), true);
  assert.equal(mentionsNick('@alligator не является массовым упоминанием', 'RamazanTM'), false);
});

test('diagnosticsSummary returns first failed id, else warn/ok', () => {
  assert.equal(diagnosticsSummary([{ id: 'adapter', status: 'ok' }]), 'ok');
  assert.equal(diagnosticsSummary([{ id: 'adapter', status: 'ok' }, { id: 'firewall', status: 'warn' }]), 'warn');
  assert.equal(diagnosticsSummary([{ id: 'adapter', status: 'ok' }, { id: 'peer', status: 'fail' }, { id: 'tcp', status: 'fail' }]), 'peer');
  assert.equal(diagnosticsSummary([]), 'ok');
  assert.equal(diagnosticsSummary(null), 'ok');
});
