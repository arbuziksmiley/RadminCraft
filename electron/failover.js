'use strict';

const crypto = require('node:crypto');

const FAILOVER_TIMEOUT_MS = 15000;
const CANDIDATE_STEP_MS = 5000;

const normalizeCommunityId = value => {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-f0-9-]{20,64}$/.test(id) ? id : '';
};

const cleanAddress = value => {
  const raw = String(value || '').trim().replace(/^::ffff:/, '');
  const match = raw.match(/^(26(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/);
  if (!match) return '';
  return `${match[1]}:${Number(match[2]) || 18483}`;
};

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const descriptorPayload = descriptor => ({
  communityId: normalizeCommunityId(descriptor?.communityId),
  primaryDeviceId: String(descriptor?.primaryDeviceId || ''),
  primaryHostAddress: cleanAddress(descriptor?.primaryHostAddress),
  term: Math.max(1, Number(descriptor?.term) || 1),
  enabled: descriptor?.enabled !== false,
  issuedAt: Math.max(0, Number(descriptor?.issuedAt) || 0),
  candidates: rankCandidates(descriptor?.candidates)
});

const signDescriptor = (descriptor, privateKey, publicKey) => {
  const payload = descriptorPayload(descriptor);
  return {
    ...payload,
    publicKey: String(publicKey || ''),
    signature: crypto.sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64')
  };
};

const verifyDescriptor = descriptor => {
  try {
    if (!descriptor?.publicKey || !descriptor?.signature) return false;
    return crypto.verify(
      null,
      Buffer.from(canonical(descriptorPayload(descriptor))),
      descriptor.publicKey,
      Buffer.from(descriptor.signature, 'base64')
    );
  } catch {
    return false;
  }
};

function rankCandidates(candidates) {
  const unique = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const deviceId = String(candidate?.deviceId || candidate?.id || '').trim();
    const address = cleanAddress(candidate?.address);
    const seenAt = Math.max(0, Number(candidate?.seenAt) || 0);
    // Candidate freshness is decided by the primary before it signs a
    // descriptor. Do not use Date.now() here: a signed descriptor must remain
    // byte-for-byte verifiable while the primary is offline.
    if (!deviceId || !address || candidate?.eligible === false) continue;
    const normalized = {
      deviceId,
      address,
      seenAt,
      revision: Math.max(0, Number(candidate?.revision) || 0)
    };
    const previous = unique.get(deviceId);
    if (!previous || normalized.revision > previous.revision || normalized.seenAt > previous.seenAt) unique.set(deviceId, normalized);
  }
  return [...unique.values()].sort((left, right) =>
    right.revision - left.revision ||
    right.seenAt - left.seenAt ||
    left.deviceId.localeCompare(right.deviceId)
  );
}

const promotionDelay = (candidates, deviceId) => {
  const index = rankCandidates(candidates).findIndex(candidate => candidate.deviceId === String(deviceId || ''));
  return index < 0 ? Infinity : FAILOVER_TIMEOUT_MS + index * CANDIDATE_STEP_MS;
};

const canPromote = ({ candidates, deviceId, failureSince, now = Date.now() }) =>
  Number(failureSince) > 0 && now - Number(failureSince) >= promotionDelay(candidates, deviceId);

const mergeReplicatedMessages = ({
  current,
  incoming,
  currentClearAt = 0,
  incomingClearAt = 0,
  deletedIds = []
}) => {
  const reset = Number(incomingClearAt) > Number(currentClearAt);
  const byId = new Map();
  for (const message of reset ? [] : (Array.isArray(current) ? current : [])) {
    if (Array.isArray(message) && message[6]) byId.set(String(message[6]), message.slice(0, 9));
  }
  for (const message of Array.isArray(incoming) ? incoming : []) {
    if (Array.isArray(message) && message[6]) byId.set(String(message[6]), message.slice(0, 9));
  }
  const deleted = new Set(Array.isArray(deletedIds) ? deletedIds.map(String) : []);
  return [...byId.values()].filter(message => !deleted.has(String(message[6]))).slice(-500);
};

module.exports = {
  FAILOVER_TIMEOUT_MS,
  CANDIDATE_STEP_MS,
  normalizeCommunityId,
  cleanAddress,
  descriptorPayload,
  signDescriptor,
  verifyDescriptor,
  rankCandidates,
  promotionDelay,
  canPromote,
  mergeReplicatedMessages
};
