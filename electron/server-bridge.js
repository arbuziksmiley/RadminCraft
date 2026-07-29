'use strict';
// Pure helpers for reading a Minecraft server's state without any server-side
// mod. Two sources, both available because the RadminCraft Host runs on the same
// machine as the server:
//   * logs/latest.log  -> chat messages and join/leave events (parsed here)
//   * BlueMap players.json -> who is in-game and their coordinates (merged here)
//
// Everything in this file is pure and dependency-free so the parsing rules can
// be unit-tested against real log lines (npm test).

// A valid vanilla Minecraft name: 1-16 chars of [A-Za-z0-9_]. Used to tell a
// real join/leave event from a chat message that merely contains those words.
const MC_NAME = '[A-Za-z0-9_]{1,16}';

// Some Windows launchers write UTF-8 chat text through a CP1251 console layer.
// The resulting log contains strings such as "РџСЂРёРІРµС‚". Repair only that
// recognisable mojibake pattern; ordinary Russian and English remain untouched.
const cp1251Decoder = new TextDecoder('windows-1251');
const cp1251Bytes = new Map();
for (let byte = 0; byte < 256; byte += 1) {
  cp1251Bytes.set(cp1251Decoder.decode(Uint8Array.of(byte)), byte);
}
function repairMinecraftText(value) {
  const text = String(value || '');
  if (!/[РС][\u0400-\u04ff]/u.test(text)) return text;
  const bytes = [];
  for (const char of text) {
    const byte = cp1251Bytes.get(char);
    if (byte === undefined) return text;
    bytes.push(byte);
  }
  const repaired = Buffer.from(bytes).toString('utf8');
  if (repaired.includes('\uFFFD')) return text;
  const beforeNoise = (text.match(/[РС][\u0400-\u04ff]/gu) || []).length;
  const afterNoise = (repaired.match(/[РС][\u0400-\u04ff]/gu) || []).length;
  return afterNoise < beforeNoise ? repaired : text;
}

// Parses one line of latest.log. Returns one of:
//   { type: 'chat',  name, text }
//   { type: 'join',  name }
//   { type: 'leave', name }
//   null  (anything else — commands, deaths, advancements, server noise)
function parseServerLogLine(line) {
  const raw = String(line || '');
  // Take the text after the log prefix "... ]: ". The prefix ends at the first
  // "]: " (after the [Server thread/INFO] / [minecraft/…] brackets).
  const bodyMatch = raw.match(/\]: (.*)$/);
  if (!bodyMatch) return null;
  let body = repairMinecraftText(bodyMatch[1]).trim();
  if (!body) return null;

  // 1.19+ marks unsigned chat with a "[Not Secure] " prefix.
  body = body.replace(/^\[Not Secure\]\s*/, '');
  // The integrated server used by "Open to LAN" writes received chat through
  // the client ChatComponent logger and prefixes the visible line with [CHAT].
  body = body.replace(/^\[CHAT\]\s*/, '');

  // Chat: "<Name> message". Anything inside <…> is the name; the rest is text.
  const chat = body.match(/^<([^>]{1,32})>\s?(.*)$/);
  if (chat) {
    const text = chat[2].trim();
    return text ? { type: 'chat', name: chat[1].trim(), text } : null;
  }

  const join = body.match(new RegExp(`^(${MC_NAME}) joined the game$`));
  if (join) return { type: 'join', name: join[1] };

  const leave = body.match(new RegExp(`^(${MC_NAME}) left the game$`));
  if (leave) return { type: 'leave', name: leave[1] };

  return null;
}

// Normalises a BlueMap players.json payload into a flat array of
// { uuid, name, x, z, dimension, foreign }. BlueMap has shipped a few slightly
// different shapes; this tolerates the common ones and ignores malformed rows.
function parseBlueMapPlayers(payload) {
  const list = Array.isArray(payload?.players) ? payload.players : [];
  const players = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String(entry.name || '').trim();
    const uuid = String(entry.uuid || entry.playerUuid || '').trim();
    if (!name && !uuid) continue;
    const position = entry.position || entry.pos || {};
    players.push({
      uuid,
      name,
      x: Number(position.x) || 0,
      z: Number(position.z) || 0,
      dimension: String(entry.dimension || entry.world || 'minecraft:overworld').slice(0, 80),
      foreign: Boolean(entry.foreign)
    });
  }
  return players;
}

// Case-insensitive nickname match, used to link a Minecraft player to a
// RadminCraft user who set that nickname.
function nicknameMatches(mcNickname, playerName) {
  const a = String(mcNickname || '').trim().toLowerCase();
  const b = String(playerName || '').trim().toLowerCase();
  return Boolean(a) && a === b;
}

function parseMinecraftLinkMessage(text) {
  const match = String(text || '').trim().match(/^!radmincraft\s+link\s+(\d{6})$/i);
  return match ? match[1] : '';
}

module.exports = { parseServerLogLine, parseBlueMapPlayers, nicknameMatches, parseMinecraftLinkMessage, repairMinecraftText };
