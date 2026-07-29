'use strict';
// Pure, dependency-free helpers shared by the Electron main process and the
// test suite. Nothing here may require Electron or touch module-level state, so
// it can be unit-tested with plain Node (`npm test`).

// Bump only when the HTTP contract changes in an incompatible way. The Host
// reports it in /api/health so clients can warn about mismatched builds.
const PROTOCOL_VERSION = 1;
const HOST_PORT = 18483;

const normalizeDisplayName = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 20);
const normalizeAvatarId = value => /^head-\d{3}$/.test(String(value || '')) && Number(String(value).slice(5)) < 150 ? String(value) : 'head-000';

// Accepts "26.1.2.3", "26.1.2.3:18483", "http://26.1.2.3:18483/" and returns a
// clean base URL with an http:// scheme and no trailing slash.
const hostUrl = address => {
  const raw = String(address || '').trim();
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw.replace(/\/$/, '') : `http://${raw.replace(/\/$/, '')}`;
};

// Splits a Host address into { hostname, port } for ping / TCP probes.
const parseHostTarget = (address, defaultPort = HOST_PORT) => {
  const raw = String(address || '').trim();
  try { const url = new URL(hostUrl(raw)); return { hostname: url.hostname, port: Number(url.port) || defaultPort }; }
  catch { return { hostname: raw.replace(/:\d+$/, '').replace(/^https?:\/\//, ''), port: defaultPort }; }
};

// True when a chat message addresses `nick` with an @mention. Used to decide
// between a "mention" notification and an ordinary "message" one.
// \b is ASCII-only in JavaScript, so it fails for Cyrillic nicknames and for
// nicknames ending in punctuation. A Unicode-aware negative lookahead instead
// rejects only the case where the nickname is a prefix of a longer one.
const mentionsNick = (text, nick) => {
  if (/(^|[^\p{L}\p{N}_])@all(?![\p{L}\p{N}_])/iu.test(String(text || ''))) return true;
  const name = String(nick || '').trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(String(text || ''));
};

// Picks the first-failing diagnostics step id, or 'warn'/'ok'. Kept pure so the
// verdict logic can be tested without spawning any network probes.
const diagnosticsSummary = steps => {
  const list = Array.isArray(steps) ? steps : [];
  const failed = list.find(step => step && step.status === 'fail');
  if (failed) return failed.id;
  return list.some(step => step && step.status === 'warn') ? 'warn' : 'ok';
};

module.exports = {
  PROTOCOL_VERSION,
  HOST_PORT,
  normalizeDisplayName,
  normalizeAvatarId,
  hostUrl,
  parseHostTarget,
  mentionsNick,
  diagnosticsSummary
};
