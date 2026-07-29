'use strict';

const crypto = require('node:crypto');

const BRIDGE_PROTOCOL = Object.freeze({ major: 1, minor: 1 });
const MAX_OUTBOX = 500;
const COMMAND_TTL = 10 * 60 * 1000;
const cleanText = (value, max) => String(value || '').replace(/\u0000/g, '').slice(0, max);

const isLoopbackAddress = address => {
  const value = String(address || '').replace(/^::ffff:/, '');
  return value === '127.0.0.1' || value === '::1';
};

const normalizeHeartbeat = body => ({
  protocolMajor: Math.max(0, Number(body?.protocolMajor) || 0),
  protocolMinor: Math.max(0, Number(body?.protocolMinor) || 0),
  bridgeVersion: cleanText(body?.bridgeVersion, 40),
  minecraftVersion: cleanText(body?.minecraftVersion, 30),
  forgeVersion: cleanText(body?.forgeVersion, 40),
  serverKind: body?.serverKind === 'integrated' ? 'integrated' : 'dedicated',
  serverId: cleanText(body?.serverId, 80),
  players: Math.max(0, Math.min(1000, Number(body?.players) || 0))
});

const normalizeGameChat = body => ({
  eventId: cleanText(body?.eventId, 80),
  serverId: cleanText(body?.serverId, 80),
  playerId: cleanText(body?.playerId || body?.id, 80),
  player: cleanText(body?.player, 16).trim(),
  text: cleanText(body?.text, 600).trim(),
  createdAt: Math.max(0, Number(body?.createdAt) || Date.now())
});

const normalizePlayerStatus = body => ({
  eventId: cleanText(body?.eventId, 80),
  serverId: cleanText(body?.serverId, 80),
  id: cleanText(body?.id, 80),
  name: cleanText(body?.name, 16).trim(),
  inGame: body?.inGame !== false,
  x: Number.isFinite(Number(body?.x)) ? Number(body.x) : 0,
  z: Number.isFinite(Number(body?.z)) ? Number(body.z) : 0,
  dimension: cleanText(body?.dimension || 'minecraft:overworld', 80)
});

const commandFromMessage = (message, now = Date.now()) => {
  if (!Array.isArray(message) || !['app', 'host'].includes(message[2])) return null;
  const text = cleanText(message[3], 600).trim();
  const author = cleanText(message[1], 20).trim();
  if (!text || !author) return null;
  return {
    id: cleanText(message[6], 80) || crypto.randomUUID(),
    type: 'chat.broadcast',
    createdAt: now,
    payload: { author, text }
  };
};

class BridgeOutbox {
  constructor({ max = MAX_OUTBOX, ttl = COMMAND_TTL } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.commands = new Map();
  }
  prune(now = Date.now()) {
    for (const [id, command] of this.commands) if (now - command.createdAt > this.ttl) this.commands.delete(id);
    while (this.commands.size > this.max) this.commands.delete(this.commands.keys().next().value);
  }
  enqueue(command, now = Date.now()) {
    if (!command?.id || !command?.type) return false;
    this.prune(now);
    this.commands.set(command.id, command);
    this.prune(now);
    return true;
  }
  list(limit = 50, now = Date.now()) {
    this.prune(now);
    return [...this.commands.values()].slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  }
  acknowledge(ids) {
    let removed = 0;
    for (const id of Array.isArray(ids) ? ids : []) if (this.commands.delete(String(id))) removed++;
    return removed;
  }
}

module.exports = {
  BRIDGE_PROTOCOL, MAX_OUTBOX, COMMAND_TTL, isLoopbackAddress,
  normalizeHeartbeat, normalizeGameChat, normalizePlayerStatus,
  commandFromMessage, BridgeOutbox
};
