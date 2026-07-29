const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog, screen, clipboard, crashReporter } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { PROTOCOL_VERSION, HOST_PORT, normalizeDisplayName, normalizeAvatarId, hostUrl, parseHostTarget, diagnosticsSummary } = require('./protocol');
const { parseServerLogLine, parseBlueMapPlayers, nicknameMatches, parseMinecraftLinkMessage } = require('./server-bridge');
const { cleanAddress, signDescriptor, verifyDescriptor, rankCandidates, canPromote, mergeReplicatedMessages } = require('./failover');
const {
  BRIDGE_PROTOCOL, isLoopbackAddress, normalizeHeartbeat, normalizeGameChat,
  normalizePlayerStatus, commandFromMessage, BridgeOutbox
} = require('./bridge-protocol');
const { setupAutoUpdater } = require('./updater');
const appIconPath = path.join(__dirname, 'app-icon.ico');

const incidentId = `${new Date().toISOString().replace(/[:.]/g, '-')}-pid-${process.pid}`;
const diagnosticsDir = path.join(app.getPath('userData'), 'logs');
const incidentLogPath = path.join(diagnosticsDir, `incident-${incidentId}.jsonl`);
const serializeError = error => error instanceof Error
  ? { name: error.name, message: error.message, code: error.code || '', stack: error.stack || '' }
  : String(error ?? '');
function diagnosticLog(event, details = {}) {
  try {
    fsSync.mkdirSync(diagnosticsDir, { recursive: true });
    fsSync.appendFileSync(incidentLogPath, `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`, 'utf8');
  } catch {}
}
fsSync.mkdirSync(diagnosticsDir, { recursive: true });
app.setPath('crashDumps', path.join(diagnosticsDir, 'crash-dumps'));
crashReporter.start({ uploadToServer: false, compress: false });
process.on('uncaughtException', error => diagnosticLog('main.uncaught-exception', { error: serializeError(error) }));
process.on('unhandledRejection', error => diagnosticLog('main.unhandled-rejection', { error: serializeError(error) }));
diagnosticLog('app.process-start', { version: app.getVersion(), platform: process.platform, arch: process.arch, pid: process.pid });

const defaults = {
  displayName: 'Вы', avatar: 'head-000', avatarImage: '', serverName: 'Мой сервер', mode: 'client', hostAddress: '', onboardingCompleted: false,
  launcherPath: '', widgetEnabled: false, theme: 'soft', notificationsEnabled: true, volume: 70,
  // Per-event notification switches. notificationsEnabled is the master toggle.
  notifyChatAll: false, notifyMentions: true, notifyVoiceInvite: true, notifyPlayerJoin: true,
  mapPort: 8100, mapUrl: '', modsUrl: '', contactAliases: {}, mcVersion: '1.20.1 Forge',
  // Server integration (Host only, no mod). serverPath points at the Forge
  // server folder (or directly at latest.log); mcNickname links this user to
  // their in-game name. serverBridgeConfigured hides the setup badge once done.
  serverPath: '', serverMode: 'dedicated', mcNickname: '', serverBridgeConfigured: false, bridgeServerId: '',
  incomingMessageVolume: 100, outgoingMessageVolume: 100, voiceInviteVolume: 100,
  incomingMessageSound: 'message-3', outgoingMessageSound: 'message-4', voiceInviteSound: 'invite-4',
  launchAtStartup: false, readMentionIds: [],
  // A community is independent from a Radmin VPN network. One VPN adapter can
  // carry several communities; communityId prevents their state from mixing.
  communityId: '', primaryHostAddress: '', primaryHostDeviceId: '',
  communityTerm: 1, temporaryHostEnabled: true, temporaryHostEligible: true,
  temporaryHostPrepared: false, temporaryHostPreparationAttempted: false,
  updateDeferredVersion: '', updateDeferredUntil: 0
};
const configPath = () => path.join(app.getPath('userData'), 'settings.json');
const messagesPath = () => path.join(app.getPath('userData'), 'chat-history.json');
const identityPath = () => path.join(app.getPath('userData'), 'identity.json');
const membersPath = () => path.join(app.getPath('userData'), 'community-members.json');
const failoverPath = () => path.join(app.getPath('userData'), 'failover-state.json');
const failoverJournalPath = () => path.join(app.getPath('userData'), 'failover-journal.json');
let mainWindow;
let tray;
let hostServer;
let hostStartPromise;
let hostMessages = [];
let quitApproved = false;
let settingsWriteQueue = Promise.resolve();
let membersWriteQueue = Promise.resolve();
const hostPresence = new Map();
const hostMembers = new Map();
const voiceSignals = new Map();
const voiceInvites = new Map();
// Short-lived, device-bound Minecraft link challenges. Players complete a
// challenge by writing "!radmincraft link 123456" in the Minecraft chat. The
// Host observes that ordinary chat line in latest.log, so no Forge mod/plugin
// is required and the verification cannot be claimed by another device.
const minecraftLinkChallenges = new Map();
let bridgeState = { connected: false, seenAt: 0, players: 0, mapPlayers: [], protocol: null, bridgeVersion: '', minecraftVersion: '', forgeVersion: '', serverKind: '' };
const bridgeOutbox = new BridgeOutbox();
const bridgeEventIds = new Map();
const recentGameChat = new Map();
// Minecraft players currently on the server, keyed by lower-case name. Filled by
// the log tail (join/leave) and the BlueMap poll (coordinates). No server-side
// mod involved — see electron/server-bridge.js.
const serverPlayers = new Map();
const PLAYER_TTL = 40000;
let logTail = null;         // { path, size, timer }
let bluemapTimer = null;
let bluemapMapIds = null;   // cached list of BlueMap map ids
let launcherState = { active: false, path: '', processId: 0, startedAt: 0 };
let launcherDetection = { checkedAt: 0, active: false, lastSeenAt: 0, misses: 0 };
let widgetState = { online: 0, inGame: 0, serverName: '' };
let hostInstanceId = '';
let hostRuntime = { role: '', communityId: '', primaryHostAddress: '', primaryDeviceId: '', term: 1 };
let primaryFailureSince = 0;
let failoverWriteQueue = Promise.resolve();
let activeTemporaryStatus = null;
let recoveryProbeRunning = false;
let lastRecoveryProbeAt = 0;
let hostDeletedMessageIds = new Set();
let hostChatClearedAt = 0;
const hostPort = HOST_PORT;
// Drop players no longer seen on the server, then report whether a given
// Minecraft nickname is currently in-game.
function pruneServerPlayers() {
  const now = Date.now();
  // Players known from the log stay until their 'left' line; players known only
  // from BlueMap expire when BlueMap stops listing them.
  for (const [key, player] of serverPlayers) if (!player.viaLog && now - player.seenAt > PLAYER_TTL) serverPlayers.delete(key);
}
function isNicknameInGame(mcNickname) {
  if (!mcNickname) return false;
  pruneServerPlayers();
  for (const player of serverPlayers.values()) if (nicknameMatches(mcNickname, player.name)) return true;
  return false;
}
// A RadminCraft user is shown 'в игре' when the Minecraft nickname they linked
// is currently on the server. Status is computed at read time so it tracks
// join/leave without the client re-announcing.
const activePeople = () => [...hostPresence.values()]
  .filter(person => Date.now() - person.seenAt < 90000)
  .map(person => person.mcNickname && isNicknameInGame(person.mcNickname) ? { ...person, status: 'game' } : person);
const isNameTaken = (name, exceptId = '') => {
  const normalized = normalizeDisplayName(name).toLocaleLowerCase('ru-RU');
  return Boolean(normalized) && [...hostMembers.entries(), ...activePeople().map(person => [person.id, person.name])]
    .some(([id, registeredName]) => String(id) !== String(exceptId) && normalizeDisplayName(registeredName?.name || registeredName).toLocaleLowerCase('ru-RU') === normalized);
};

async function loadHostMembers() {
  hostMembers.clear();
  try {
    const saved = JSON.parse(await fs.readFile(membersPath(), 'utf8'));
    Object.entries(saved || {}).forEach(([id, value]) => {
      const member = typeof value === 'string' ? { name: value, avatar: 'head-000' } : value;
      const name = normalizeDisplayName(member?.name);
      if (id && name) hostMembers.set(id, { id, name, avatar: normalizeAvatarId(member?.avatar), mcNickname: String(member?.mcNickname || '').slice(0, 16), lastSeen: Number(member?.lastSeen) || 0 });
    });
  } catch { /* The registry is created after the first participant joins. */ }
}

async function rememberHostMember(id, name, avatar, mcNickname) {
  const memberId = String(id || ''); const normalized = normalizeDisplayName(name);
  if (!memberId || !normalized) return;
  const previous = hostMembers.get(memberId);
  hostMembers.set(memberId, {
    id: memberId,
    name: normalized,
    avatar: avatar ? normalizeAvatarId(avatar) : (previous?.avatar || 'head-000'),
    mcNickname: String(mcNickname ?? previous?.mcNickname ?? '').slice(0, 16),
    lastSeen: Date.now()
  });
  const snapshot = JSON.stringify(Object.fromEntries(hostMembers), null, 2);
  const save = async () => {
    await fs.mkdir(path.dirname(membersPath()), { recursive: true });
    await fs.writeFile(membersPath(), snapshot, 'utf8');
  };
  membersWriteQueue = membersWriteQueue.then(save, save);
  await membersWriteQueue;
}

async function cacheCommunityMembers(members) {
  const snapshot = {};
  for (const member of Array.isArray(members) ? members : []) {
    const id = String(member?.id || '');
    const name = normalizeDisplayName(member?.name);
    if (id && name) snapshot[id] = {
      id,
      name,
      avatar: normalizeAvatarId(member.avatar),
      mcNickname: String(member.mcNickname || '').slice(0, 16),
      lastSeen: Number(member.lastSeen) || Date.now()
    };
  }
  const save = async () => {
    await fs.mkdir(path.dirname(membersPath()), { recursive: true });
    await fs.writeFile(membersPath(), JSON.stringify(snapshot, null, 2), 'utf8');
  };
  membersWriteQueue = membersWriteQueue.then(save, save);
  await membersWriteQueue;
}

async function hasWindowsFirewallAccess(mapPort) {
  if (process.platform !== 'win32') return true;
  const script = `$service=Get-Service -Name mpssvc -ErrorAction SilentlyContinue; if(-not $service -or $service.Status -ne "Running"){"1";exit}; $enabledProfiles=@(Get-NetFirewallProfile -ErrorAction SilentlyContinue | Where-Object {$_.Enabled -eq $true}); if($enabledProfiles.Count -eq 0){"1";exit}; $connection=Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object InterfaceAlias -Match "Radmin" | Select-Object -First 1; if($connection){$profileName=if($connection.NetworkCategory -eq "DomainAuthenticated"){"Domain"}else{[string]$connection.NetworkCategory}; $activeFirewall=Get-NetFirewallProfile -Name $profileName -ErrorAction SilentlyContinue; if(-not $activeFirewall -or -not $activeFirewall.Enabled){"1";exit}}; $ok=$true; foreach($port in @(${hostPort},${mapPort}) | Select-Object -Unique){ $rules=Get-NetFirewallRule -DisplayName ("RadminCraft TCP " + $port) -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq "True" -and $_.Direction -eq "Inbound" -and $_.Action -eq "Allow" }; $filter=$rules | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue | Where-Object { $_.Protocol -eq "TCP" -and ($_.LocalPort -eq [string]$port -or $_.LocalPort -eq "Any") }; if(-not $filter){$ok=$false} }; if($ok){"1"}else{"0"}`;
  try {
    const result = await execFileAsync('powershell.exe', ['-WindowStyle', 'Hidden', '-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, windowsHide: true });
    return result.stdout.trim() === '1';
  } catch { return false; }
}

async function ensureWindowsFirewallAccess() {
  diagnosticLog('firewall.ensure-start');
  if (process.platform !== 'win32') return { ok: true, changed: false };
  const settings = await readSettings();
  const mapPort = Math.max(1, Math.min(65535, Number(settings.mapPort) || 8100));
  if (await hasWindowsFirewallAccess(mapPort)) { diagnosticLog('firewall.already-allowed', { ports: [hostPort, mapPort] }); return { ok: true, changed: false, ports: [hostPort, mapPort] }; }
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$ports = @(${hostPort}, ${mapPort}) | Select-Object -Unique`,
    'foreach ($port in $ports) {',
    '  $name = "RadminCraft TCP $port"',
    '  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue',
    '  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -RemoteAddress "26.0.0.0/8" -Profile Any | Out-Null',
    '}'
  ].join('\r\n');
  const helperPath = path.join(app.getPath('temp'), `RadminCraft-firewall-${crypto.randomUUID()}.ps1`);
  await fs.writeFile(helperPath, script, 'utf8');
  const argumentLine = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${helperPath.replace(/"/g, '""')}"`;
  const elevate = `$process = Start-Process -FilePath "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '${argumentLine.replace(/'/g, "''")}'; exit $process.ExitCode`;
  try {
    await execFileAsync('powershell.exe', ['-WindowStyle', 'Hidden', '-NoProfile', '-NonInteractive', '-Command', elevate], {
      timeout: 90000,
      windowsHide: true
    });
    if (!await hasWindowsFirewallAccess(mapPort)) { diagnosticLog('firewall.verification-failed', { ports: [hostPort, mapPort] }); return { ok: false, reason: 'firewall-verification-failed' }; }
    diagnosticLog('firewall.rules-created', { ports: [hostPort, mapPort] });
    return { ok: true, changed: true, ports: [hostPort, mapPort] };
  } catch (error) {
    diagnosticLog('firewall.ensure-failed', { error: serializeError(error) });
    return { ok: false, reason: error.code === 'ETIMEDOUT' ? 'firewall-timeout' : 'firewall-denied', detail: String(error.stderr || error.message || error.code || '').slice(0, 300) };
  } finally {
    await fs.unlink(helperPath).catch(() => {});
  }
}

async function getLauncherState() {
  const settings = await readSettings(); const configuredPath = settings.launcherPath || launcherState.path;
  if (!configuredPath) return { ...launcherState, active: false };
  // Process discovery starts a small Windows helper. A ten-second cache keeps
  // presence accurate enough without waking PowerShell several times a second.
  if (Date.now() - launcherDetection.checkedAt < 10000) return { ...launcherState, path: configuredPath, active: launcherDetection.active };
  const configuredName = path.basename(configuredPath, path.extname(configuredPath)); let active = false;
  if (launcherState.processId) { try { process.kill(launcherState.processId, 0); active = true; } catch { launcherState.processId = 0; } }
  if (!active && process.platform === 'win32') {
    try {
      const script = "$name=$env:RC_LAUNCHER_NAME; if(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -ieq $name -or $_.MainWindowTitle -like ('*'+$name+'*') -or ($name -match 'tlauncher' -and $_.MainWindowTitle -like '*TLauncher*') } | Select-Object -First 1){'1'}";
      const result = await execFileAsync('powershell.exe', ['-WindowStyle', 'Hidden', '-NoProfile', '-NonInteractive', '-Command', script], { timeout: 2500, windowsHide: true, env: { ...process.env, RC_LAUNCHER_NAME: configuredName } }); active = result.stdout.trim() === '1';
    } catch { active = false; }
  }
  const now = Date.now();
  if (active) launcherDetection = { checkedAt: now, active: true, lastSeenAt: now, misses: 0 };
  else {
    const misses = (launcherDetection.misses || 0) + 1;
    const withinGrace = launcherDetection.active && now - (launcherDetection.lastSeenAt || 0) < 12000 && misses < 3;
    launcherDetection = { ...launcherDetection, checkedAt: now, active: withinGrace, misses };
    active = withinGrace;
  }
  launcherState = { ...launcherState, active, path: configuredPath }; return { ...launcherState };
}

// Map markers for the map view: every server player that has coordinates, with
// the linked RadminCraft display name substituted in when we know it.
function bridgeMapPlayers() {
  pruneServerPlayers();
  const linkedName = mcName => {
    for (const person of hostPresence.values()) if (person.mcNickname && nicknameMatches(person.mcNickname, mcName)) return person.name;
    return null;
  };
  return [...serverPlayers.values()]
    .filter(player => player.hasCoords)
    .map(player => ({ id: player.uuid || player.name, name: linkedName(player.name) || player.name, x: player.x, z: player.z, dimension: player.dimension }));
}

// Records a chat line read from the server log as an 'в игре' message.
function linkedRadminCraftProfile(mcNickname) {
  const candidates = [...hostPresence.values(), ...hostMembers.values()];
  return candidates.find(person => person?.mcNickname && nicknameMatches(person.mcNickname, mcNickname)) || null;
}

async function pushGameChat(name, text) {
  const linked = linkedRadminCraftProfile(name);
  const clean = normalizeDisplayName(linked?.name || name);
  const message = String(text || '').slice(0, 600);
  if (!clean || !message) return;
  const fingerprint = `${String(name).toLowerCase()}\n${message}`;
  const now = Date.now();
  const previous = recentGameChat.get(fingerprint) || 0;
  recentGameChat.set(fingerprint, now);
  for (const [key, seenAt] of recentGameChat) if (now - seenAt > 5000) recentGameChat.delete(key);
  if (now - previous < 2500) return;
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  hostMessages.push([
    linked ? normalizeAvatarId(linked.avatar) : String(clean[0] || '?').slice(0, 2),
    clean,
    'game',
    message,
    time,
    null,
    crypto.randomUUID(),
    linked ? String(linked.id) : `mc:${String(name).toLowerCase()}`
  ]);
  await writeMessages(hostMessages);
  bridgeState = { ...bridgeState, connected: true, seenAt: Date.now() };
}

function rememberBridgeEvent(eventId) {
  if (!eventId) return false;
  const now = Date.now();
  for (const [id, seenAt] of bridgeEventIds) if (now - seenAt > 10 * 60 * 1000) bridgeEventIds.delete(id);
  if (bridgeEventIds.has(eventId)) return true;
  bridgeEventIds.set(eventId, now);
  return false;
}

function queueBridgeMessage(message) {
  const command = commandFromMessage(message);
  if (command) bridgeOutbox.enqueue(command);
}

function pruneMinecraftLinkChallenges() {
  const now = Date.now();
  for (const [code, challenge] of minecraftLinkChallenges) {
    if (challenge.expiresAt <= now && !challenge.mcNickname) minecraftLinkChallenges.delete(code);
  }
}
async function completeMinecraftLink(code, mcNickname) {
  pruneMinecraftLinkChallenges();
  const challenge = minecraftLinkChallenges.get(String(code));
  if (!challenge || challenge.expiresAt <= Date.now() || challenge.mcNickname) return false;
  challenge.mcNickname = String(mcNickname || '').trim().slice(0, 16);
  challenge.completedAt = Date.now();
  const presence = hostPresence.get(challenge.deviceId);
  if (presence) hostPresence.set(challenge.deviceId, { ...presence, mcNickname: challenge.mcNickname, status: 'game', seenAt: Date.now() });
  const member = hostMembers.get(challenge.deviceId);
  if (member) await rememberHostMember(challenge.deviceId, member.name, member.avatar, challenge.mcNickname);
  const profile = hostPresence.get(challenge.deviceId) || hostMembers.get(challenge.deviceId);
  if (profile) {
    let changed = false;
    hostMessages = hostMessages.map(message => {
      if (message[7] !== `mc:${challenge.mcNickname.toLowerCase()}`) return message;
      const updated = [...message];
      updated[0] = normalizeAvatarId(profile.avatar);
      updated[1] = normalizeDisplayName(profile.name);
      updated[7] = challenge.deviceId;
      changed = true;
      return updated;
    });
    if (changed) await writeMessages(hostMessages);
  }
  diagnosticLog('minecraft.link-completed', { deviceId: challenge.deviceId, mcNickname: challenge.mcNickname });
  return true;
}

function markServerPlayer(name, extra = {}) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return;
  const previous = serverPlayers.get(key) || { name: String(name).trim(), uuid: '', x: 0, z: 0, dimension: 'minecraft:overworld', hasCoords: false };
  serverPlayers.set(key, { ...previous, ...extra, name: previous.name || String(name).trim(), seenAt: Date.now() });
  bridgeState = { ...bridgeState, connected: true, seenAt: Date.now(), players: serverPlayers.size, mapPlayers: bridgeMapPlayers() };
}
function removeServerPlayer(name) {
  serverPlayers.delete(String(name || '').trim().toLowerCase());
  bridgeState = { ...bridgeState, seenAt: Date.now(), players: serverPlayers.size, mapPlayers: bridgeMapPlayers() };
}

// ── Server bridge orchestration (Host only, no mod) ──────────────────────
// Accepts either the server folder or a direct path to latest.log.
function resolveLogPath(serverPath) {
  const raw = String(serverPath || '').trim();
  if (!raw) return '';
  if (/\.log$/i.test(raw)) return raw;
  return path.join(raw, 'logs', 'latest.log');
}

function handleLogChunk(chunk) {
  logTail.buffer += chunk;
  const lines = logTail.buffer.split(/\r?\n/);
  logTail.buffer = lines.pop() || ''; // keep the trailing partial line
  for (const line of lines) {
    const event = parseServerLogLine(line);
    if (!event) continue;
    // The Forge Bridge is the authoritative UTF-8 source while it is alive.
    // latest.log remains a fallback for installations without the mod. Reading
    // both paths caused every Cyrillic line to appear twice, with the log copy
    // sometimes decoded as replacement characters.
    if (bridgeState.connected && Date.now() - bridgeState.seenAt < 30000) continue;
    if (event.type === 'chat') {
      const linkCode = parseMinecraftLinkMessage(event.text);
      if (linkCode) completeMinecraftLink(linkCode, event.name).catch(() => {});
      else pushGameChat(event.name, event.text).catch(() => {});
    }
    else if (event.type === 'join') markServerPlayer(event.name, { viaLog: true });
    else if (event.type === 'leave') removeServerPlayer(event.name);
  }
}

function readNewLogData() {
  if (!logTail) return;
  let stat;
  try { stat = fsSync.statSync(logTail.path); }
  catch { return; } // file not present yet; try again next tick
  if (stat.size < logTail.size) { logTail.size = 0; logTail.buffer = ''; } // rotated
  if (stat.size === logTail.size) return;
  try {
    const fd = fsSync.openSync(logTail.path, 'r');
    const length = stat.size - logTail.size;
    const data = Buffer.alloc(length);
    fsSync.readSync(fd, data, 0, length, logTail.size);
    fsSync.closeSync(fd);
    logTail.size = stat.size;
    handleLogChunk(data.toString('utf8'));
  } catch (error) { diagnosticLog('bridge.log-read-failed', { error: serializeError(error) }); }
}

function startLogTail(logPath) {
  let size = 0;
  try { size = fsSync.statSync(logPath).size; } catch { size = 0; } // start at end: don't replay old chat
  logTail = { path: logPath, size, buffer: '', timer: setInterval(readNewLogData, 2000) };
  diagnosticLog('bridge.log-tail-start', { path: logPath, startSize: size });
}

function bluemapBase(settings) {
  const port = Math.max(1, Math.min(65535, Number(settings.mapPort) || 8100));
  let base = String(settings.mapUrl || '').trim() || `http://127.0.0.1:${port}/`;
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  if (!base.endsWith('/')) base += '/';
  return base;
}

async function pollBlueMapPlayers() {
  const settings = await readSettings();
  if (settings.mode !== 'host') return;
  const base = bluemapBase(settings);
  try {
    if (!bluemapMapIds) {
      const response = await fetch(`${base}settings.json`, { signal: AbortSignal.timeout(2800) });
      const body = await response.json();
      bluemapMapIds = Array.isArray(body?.maps) ? body.maps : Object.keys(body?.maps || {});
      if (!bluemapMapIds.length) { bluemapMapIds = null; return; }
    }
    for (const id of bluemapMapIds) {
      const response = await fetch(`${base}maps/${encodeURIComponent(id)}/live/players.json`, { signal: AbortSignal.timeout(2800) });
      if (!response.ok) continue;
      const players = parseBlueMapPlayers(await response.json());
      for (const player of players) {
        if (player.foreign) markServerPlayer(player.name, { uuid: player.uuid });
        else markServerPlayer(player.name, { uuid: player.uuid, x: player.x, z: player.z, dimension: player.dimension, hasCoords: true });
      }
    }
  } catch { bluemapMapIds = null; /* rediscover next poll */ }
}

async function startServerBridge() {
  stopServerBridge();
  const settings = await readSettings();
  if (settings.mode !== 'host') return;
  const logPath = resolveLogPath(settings.serverPath);
  if (logPath) startLogTail(logPath);
  bluemapTimer = setInterval(() => pollBlueMapPlayers().catch(() => {}), 5000);
  pollBlueMapPlayers().catch(() => {});
  diagnosticLog('bridge.start', { hasLog: Boolean(logPath), mapPort: settings.mapPort });
}

function stopServerBridge() {
  if (logTail?.timer) clearInterval(logTail.timer);
  logTail = null;
  if (bluemapTimer) clearInterval(bluemapTimer);
  bluemapTimer = null;
  bluemapMapIds = null;
  serverPlayers.clear();
}

// Visual-regression runs must not activate the user's already running portable
// build. Give the capture process an isolated Electron profile and mutex.
if (process.env.RADMINCRAFT_CAPTURE_SETTINGS) {
  app.setPath('userData', path.join(app.getPath('temp'), `RadminCraft-capture-${process.pid}`));
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

async function readSettings() {
  try {
    const saved = { ...defaults, ...JSON.parse(await fs.readFile(configPath(), 'utf8')) };
    const mapPort = Number(saved.mapPort) === 8080 && !String(saved.mapUrl || '').trim() ? 8100 : saved.mapPort;
    const mcVersion = String(saved.mcVersion || defaults.mcVersion).trim().slice(0, 40) || defaults.mcVersion;
    delete saved.communitySecret;
    return { ...saved, mapPort, mcVersion, displayName: normalizeDisplayName(saved.displayName) || defaults.displayName, avatar: normalizeAvatarId(saved.avatar), avatarImage: '', theme: 'soft' };
  }
  catch { return { ...defaults, avatar: 'head-000', avatarImage: '' }; }
}

function writeSettings(partial) {
  const save = async () => {
    const current = await readSettings();
    const next = { ...current, ...partial, displayName: normalizeDisplayName(partial.displayName ?? current.displayName) || current.displayName, avatar: normalizeAvatarId(partial.avatar ?? current.avatar), avatarImage: '', theme: 'soft' };
    delete next.communitySecret;
    await fs.mkdir(path.dirname(configPath()), { recursive: true });
    await fs.writeFile(configPath(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  };
  settingsWriteQueue = settingsWriteQueue.then(save, save);
  return settingsWriteQueue;
}

async function readMessages() {
  try { return JSON.parse(await fs.readFile(messagesPath(), 'utf8')); }
  catch { return []; }
}

async function writeMessages(messages) {
  await fs.mkdir(path.dirname(messagesPath()), { recursive: true });
  await fs.writeFile(messagesPath(), JSON.stringify(messages.slice(-500), null, 2), 'utf8');
}

async function loadFailoverJournal(communityId) {
  try {
    const journal = JSON.parse(await fs.readFile(failoverJournalPath(), 'utf8'));
    if (journal.communityId !== communityId) throw new Error('different-community');
    hostDeletedMessageIds = new Set(Array.isArray(journal.deletedMessageIds) ? journal.deletedMessageIds.map(String).slice(-1000) : []);
    hostChatClearedAt = Math.max(0, Number(journal.chatClearedAt) || 0);
  } catch {
    hostDeletedMessageIds = new Set();
    hostChatClearedAt = 0;
  }
}

async function writeFailoverJournal() {
  await fs.mkdir(path.dirname(failoverJournalPath()), { recursive: true });
  await fs.writeFile(failoverJournalPath(), JSON.stringify({
    communityId: hostRuntime.communityId,
    deletedMessageIds: [...hostDeletedMessageIds].slice(-1000),
    chatClearedAt: hostChatClearedAt
  }, null, 2), 'utf8');
}

async function readFailoverState() {
  try {
    const saved = JSON.parse(await fs.readFile(failoverPath(), 'utf8'));
    return saved && typeof saved === 'object' ? saved : { communities: {} };
  } catch {
    return { communities: {} };
  }
}

function writeFailoverState(partial) {
  const save = async () => {
    const current = await readFailoverState();
    const next = { ...current, ...partial, communities: { ...(current.communities || {}), ...(partial.communities || {}) } };
    await fs.mkdir(path.dirname(failoverPath()), { recursive: true });
    await fs.writeFile(failoverPath(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  };
  failoverWriteQueue = failoverWriteQueue.then(save, save);
  return failoverWriteQueue;
}

async function rememberFailoverDescriptor(descriptor, primaryAddress) {
  if (!verifyDescriptor(descriptor)) return { ok: false, reason: 'invalid-signature' };
  const state = await readFailoverState();
  const previous = state.communities?.[descriptor.communityId];
  if (previous?.publicKey && previous.publicKey !== descriptor.publicKey) return { ok: false, reason: 'primary-key-changed' };
  if (previous && Number(descriptor.term) < Number(previous.term || 0)) return { ok: false, reason: 'stale-term' };
  const stored = {
    ...descriptor,
    primaryHostAddress: cleanAddress(primaryAddress || descriptor.primaryHostAddress),
    lastPrimarySeenAt: Date.now(),
    failureSince: 0
  };
  await writeFailoverState({ communities: { [descriptor.communityId]: stored } });
  const settings = await readSettings();
  if (settings.communityId !== descriptor.communityId ||
      settings.primaryHostDeviceId !== descriptor.primaryDeviceId ||
      settings.primaryHostAddress !== stored.primaryHostAddress) {
    await writeSettings({
      communityId: descriptor.communityId,
      primaryHostDeviceId: descriptor.primaryDeviceId,
      primaryHostAddress: stored.primaryHostAddress
    });
  }
  if (descriptor.enabled !== false &&
      settings.mode === 'client' &&
      settings.onboardingCompleted &&
      settings.temporaryHostEligible !== false &&
      !settings.temporaryHostPrepared &&
      !settings.temporaryHostPreparationAttempted) {
    const firewall = await ensureWindowsFirewallAccess();
    await writeSettings({ temporaryHostPrepared: Boolean(firewall.ok), temporaryHostPreparationAttempted: true });
    if (!firewall.ok) diagnosticLog('failover.candidate-firewall-unavailable', { reason: firewall.reason });
  }
  primaryFailureSince = 0;
  return { ok: true, descriptor: stored };
}

const requestRadminAddress = request => {
  const address = cleanAddress(request.socket?.remoteAddress);
  return address || '';
};

async function primaryFailoverDescriptor(settings) {
  const [identity, vpn] = await Promise.all([readIdentity(), radminVpnStatus()]);
  const candidates = activePeople()
    .filter(person => person.id !== identity.deviceId && person.failoverEligible !== false && person.address)
    .map(person => ({
      deviceId: person.id,
      address: person.address,
      seenAt: person.seenAt,
      revision: hostMessages.length
    }));
  return signDescriptor({
    communityId: settings.communityId,
    primaryDeviceId: identity.deviceId,
    primaryHostAddress: cleanAddress(vpn.address || settings.primaryHostAddress),
    term: Math.max(1, Number(hostRuntime.term) || 1),
    enabled: settings.temporaryHostEnabled !== false,
    issuedAt: Date.now(),
    candidates
  }, identity.privateKey, identity.publicKey);
}

const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); response.end(JSON.stringify(body)); };
const readBody = request => new Promise((resolve, reject) => { let body = ''; request.on('data', chunk => { body += chunk; if (body.length > 128000) request.destroy(); }); request.on('end', () => resolve(body)); request.on('error', reject); });
async function startHost(options = {}) {
  if (hostServer?.listening) return { ok: true, port: hostPort };
  if (hostStartPromise) return hostStartPromise;
  hostStartPromise = (async () => {
  const vpn = await radminVpnStatus();
  diagnosticLog('host.start-attempt', { vpn, alreadyListening: Boolean(hostServer?.listening), port: hostPort });
  if (!vpn.detected) { const error = new Error('Radmin VPN is not running'); error.code = 'RADMIN_VPN_UNAVAILABLE'; throw error; }
  if (hostServer?.listening) return { ok: true, port: hostPort };
  let settings = await readSettings();
  const identity = await readIdentity();
  if (!settings.communityId && options.role !== 'temporary') {
    settings = await writeSettings({
      communityId: crypto.randomUUID(),
      primaryHostDeviceId: identity.deviceId,
      primaryHostAddress: cleanAddress(vpn.address)
    });
  }
  if (options.role !== 'temporary' &&
      (settings.primaryHostDeviceId !== identity.deviceId || settings.primaryHostAddress !== cleanAddress(vpn.address))) {
    settings = await writeSettings({
      primaryHostDeviceId: identity.deviceId,
      primaryHostAddress: cleanAddress(vpn.address)
    });
  }
  hostRuntime = options.role === 'temporary'
    ? {
        role: 'temporary',
        communityId: String(options.descriptor?.communityId || settings.communityId),
        primaryHostAddress: cleanAddress(options.descriptor?.primaryHostAddress || settings.primaryHostAddress || settings.hostAddress),
        primaryDeviceId: String(options.descriptor?.primaryDeviceId || settings.primaryHostDeviceId),
        term: Math.max(2, Number(options.descriptor?.term || 1) + 1)
      }
    : {
        role: 'primary',
        communityId: settings.communityId,
        primaryHostAddress: cleanAddress(vpn.address),
        primaryDeviceId: identity.deviceId,
        term: Math.max(1, Number(settings.communityTerm) || 1, Number(options.term) || 1)
      };
  const firewallAllowed = await hasWindowsFirewallAccess(Math.max(1, Math.min(65535, Number(settings.mapPort) || 8100)));
  diagnosticLog('host.firewall-state', { allowed: firewallAllowed });
  hostInstanceId = crypto.randomUUID();
  await loadHostMembers();
  await loadFailoverJournal(hostRuntime.communityId);
  hostMessages = (await readMessages())
    .filter(message => !new Set(['RamazanTM|19:24', 'Masha|19:25', 'Alex|19:27']).has(`${message?.[1]}|${message?.[4]}`))
    .filter(message => {
      if (message?.[2] !== 'game') return true;
      const text = String(message?.[3] || '');
      const replacements = (text.match(/\uFFFD/g) || []).length;
      return replacements < 2 || /[\p{L}\p{N}]/u.test(text.replace(/\uFFFD/g, ''));
    })
    .map(message => { if (!message[6]) message[6] = crypto.randomUUID(); return message; });
  await writeMessages(hostMessages);
  hostServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      const settings = await readSettings();
      const failover = hostRuntime.role === 'primary'
        ? await primaryFailoverDescriptor(settings)
        : (await readFailoverState()).communities?.[hostRuntime.communityId] || null;
      return json(response, 200, {
        ok: true,
        serverName: settings.serverName,
        version: 1,
        protocol: PROTOCOL_VERSION,
        mcVersion: settings.mcVersion || defaults.mcVersion,
        instanceId: hostInstanceId,
        mapPort: Number(settings.mapPort) || 8100,
        mapUrl: hostRuntime.role === 'temporary' ? '' : (settings.mapUrl || ''),
        modsUrl: settings.modsUrl || '',
        communityId: hostRuntime.communityId,
        hostRole: hostRuntime.role,
        currentHostDeviceId: hostRuntime.role === 'temporary' ? identity.deviceId : hostRuntime.primaryDeviceId,
        term: hostRuntime.term,
        failover
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/failover/recover') {
      if (hostRuntime.role !== 'primary') return json(response, 409, { ok: false, reason: 'not-primary' });
      try {
        const body = JSON.parse(await readBody(request));
        if (String(body.communityId || '') !== hostRuntime.communityId) return json(response, 409, { ok: false, reason: 'wrong-community' });
        const incoming = Array.isArray(body.messages) ? body.messages.slice(-500) : [];
        const incomingClear = Math.max(0, Number(body.chatClearedAt) || 0);
        if (incomingClear > hostChatClearedAt) {
          hostMessages = [];
          hostDeletedMessageIds.clear();
          hostChatClearedAt = incomingClear;
        }
        const incomingDeleted = new Set(Array.isArray(body.deletedMessageIds) ? body.deletedMessageIds.map(String).slice(-1000) : []);
        incomingDeleted.forEach(id => hostDeletedMessageIds.add(id));
        hostMessages = mergeReplicatedMessages({
          current: hostMessages,
          incoming,
          currentClearAt: hostChatClearedAt,
          incomingClearAt: incomingClear,
          deletedIds: [...hostDeletedMessageIds]
        });
        for (const member of Array.isArray(body.members) ? body.members : []) {
          if (member?.id && member?.name) await rememberHostMember(member.id, member.name, member.avatar, member.mcNickname);
        }
        await writeMessages(hostMessages);
        await writeFailoverJournal();
        hostRuntime.term = Math.max(hostRuntime.term, Number(body.term) || 0) + 1;
        await writeSettings({ communityTerm: hostRuntime.term });
        diagnosticLog('failover.primary-recovered', { messages: incoming.length, term: hostRuntime.term });
        return json(response, 200, { ok: true, term: hostRuntime.term });
      } catch {
        return json(response, 400, { ok: false, reason: 'invalid-json' });
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/minecraft-link/request') {
      try {
        const bridgeSettings = await readSettings();
        const bridgeLog = resolveLogPath(bridgeSettings.serverPath);
        const liveBridge = bridgeState.connected && Date.now() - bridgeState.seenAt < 30000;
        if ((!bridgeLog || !fsSync.existsSync(bridgeLog)) && !liveBridge) {
          return json(response, 409, { ok: false, reason: 'bridge-not-configured' });
        }
        const body = JSON.parse(await readBody(request));
        const deviceId = String(body.deviceId || '').trim();
        const code = String(body.code || '').trim();
        if (!deviceId || !/^\d{6}$/.test(code)) return json(response, 400, { ok: false, reason: 'invalid-challenge' });
        pruneMinecraftLinkChallenges();
        minecraftLinkChallenges.set(code, { deviceId, expiresAt: Date.now() + 5 * 60 * 1000, mcNickname: '', completedAt: 0 });
        return json(response, 201, { ok: true, expiresIn: 600 });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/minecraft-link/status') {
      pruneMinecraftLinkChallenges();
      const code = String(url.searchParams.get('code') || '');
      const deviceId = String(url.searchParams.get('deviceId') || '');
      const challenge = minecraftLinkChallenges.get(code);
      if (!challenge || challenge.deviceId !== deviceId) return json(response, 404, { ok: false, reason: 'challenge-not-found' });
      return json(response, 200, { ok: true, linked: Boolean(challenge.mcNickname), mcNickname: challenge.mcNickname || '', expiresAt: challenge.expiresAt });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/minecraft-link/request') {
      const code = String(url.searchParams.get('code') || '');
      const deviceId = String(url.searchParams.get('deviceId') || '');
      const challenge = minecraftLinkChallenges.get(code);
      if (challenge?.deviceId === deviceId) minecraftLinkChallenges.delete(code);
      return json(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/profile/name-check') {
      try {
        const candidate = JSON.parse(await readBody(request));
        const name = normalizeDisplayName(candidate.name);
        if (!name) return json(response, 400, { ok: false, available: false, reason: 'invalid-name' });
        return json(response, 200, { ok: true, available: !isNameTaken(name, candidate.id), name });
      } catch { return json(response, 400, { ok: false, available: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/bridge/status') {
      pruneServerPlayers();
      const bridgeSettings = await readSettings();
      const bridgeLog = resolveLogPath(bridgeSettings.serverPath);
      return json(response, 200, {
        connected: bridgeState.connected && Date.now() - bridgeState.seenAt < 30000,
        linkAvailable: Boolean((bridgeLog && fsSync.existsSync(bridgeLog)) || (bridgeState.connected && Date.now() - bridgeState.seenAt < 30000)),
        players: serverPlayers.size,
        playerNames: [...serverPlayers.values()].map(player => player.name).filter(Boolean),
        mapPlayers: bridgeMapPlayers(),
        protocol: bridgeState.protocol,
        bridgeVersion: bridgeState.bridgeVersion,
        minecraftVersion: bridgeState.minecraftVersion,
        forgeVersion: bridgeState.forgeVersion,
        serverKind: bridgeState.serverKind
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/bridge/heartbeat') {
      if (!isLoopbackAddress(request.socket.remoteAddress)) return json(response, 403, { ok: false, reason: 'loopback-required' });
      try {
        const heartbeat = normalizeHeartbeat(JSON.parse(await readBody(request)));
        if (heartbeat.protocolMajor !== BRIDGE_PROTOCOL.major) {
          return json(response, 426, { ok: false, reason: 'protocol-major-mismatch', supported: BRIDGE_PROTOCOL });
        }
        const bridgeSettings = await readSettings();
        if (bridgeSettings.bridgeServerId && heartbeat.serverId !== bridgeSettings.bridgeServerId) {
          return json(response, 409, { ok: false, reason: 'different-minecraft-server' });
        }
        bridgeState = {
          ...bridgeState, connected: true, seenAt: Date.now(), players: heartbeat.players,
          protocol: { major: heartbeat.protocolMajor, minor: heartbeat.protocolMinor },
          bridgeVersion: heartbeat.bridgeVersion, minecraftVersion: heartbeat.minecraftVersion,
          forgeVersion: heartbeat.forgeVersion, serverKind: heartbeat.serverKind
        };
        return json(response, 200, { ok: true, protocol: BRIDGE_PROTOCOL, pollAfterMs: 1000 });
      }
      catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/bridge/chat') {
      if (!isLoopbackAddress(request.socket.remoteAddress)) return json(response, 403, { ok: false, reason: 'loopback-required' });
      try {
        const body = normalizeGameChat(JSON.parse(await readBody(request)));
        if (!body.player || !body.text) return json(response, 400, { ok: false, reason: 'invalid-message' });
        const bridgeSettings = await readSettings();
        const linkCode = parseMinecraftLinkMessage(body.text);
        // A valid one-time link challenge is the explicit operation that may
        // move the binding to another local world/server.
        if (!linkCode && bridgeSettings.bridgeServerId && body.serverId !== bridgeSettings.bridgeServerId) {
          return json(response, 409, { ok: false, reason: 'different-minecraft-server' });
        }
        if (rememberBridgeEvent(body.eventId)) return json(response, 200, { ok: true, duplicate: true });
        if (linkCode) {
          const linked = await completeMinecraftLink(linkCode, body.player);
          if (linked && body.serverId) await writeSettings({ bridgeServerId: body.serverId });
        } else {
          // Compatibility migration for profiles linked before protocol 1.1:
          // bind the first matching in-game identity to the current server.
          if (!bridgeSettings.bridgeServerId && bridgeSettings.mcNickname && nicknameMatches(bridgeSettings.mcNickname, body.player) && body.serverId) {
            await writeSettings({ bridgeServerId: body.serverId });
          } else if (!bridgeSettings.bridgeServerId) {
            return json(response, 202, { ok: true, ignored: true, reason: 'minecraft-server-not-linked' });
          }
          await pushGameChat(body.player, body.text);
        }
        bridgeState = { ...bridgeState, connected: true, seenAt: Date.now() };
        return json(response, 201, { ok: true, linked: Boolean(linkCode) });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/bridge/player-status') {
      if (!isLoopbackAddress(request.socket.remoteAddress)) return json(response, 403, { ok: false, reason: 'loopback-required' });
      try {
        const body = normalizePlayerStatus(JSON.parse(await readBody(request)));
        if (!body.id || !body.name) return json(response, 400, { ok: false, reason: 'invalid-player' });
        const bridgeSettings = await readSettings();
        if (!bridgeSettings.bridgeServerId) {
          return json(response, 202, { ok: true, ignored: true, reason: 'minecraft-server-not-linked' });
        }
        if (body.serverId !== bridgeSettings.bridgeServerId) {
          return json(response, 409, { ok: false, reason: 'different-minecraft-server' });
        }
        if (rememberBridgeEvent(body.eventId)) return json(response, 200, { ok: true, duplicate: true });
        if (body.inGame) markServerPlayer(body.name, { uuid: body.id, x: body.x, z: body.z, dimension: body.dimension, hasCoords: true, viaBridge: true });
        else removeServerPlayer(body.name);
        bridgeState = { ...bridgeState, connected: true, seenAt: Date.now() };
        return json(response, 200, { ok: true });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/bridge/commands') {
      if (!isLoopbackAddress(request.socket.remoteAddress)) return json(response, 403, { ok: false, reason: 'loopback-required' });
      const bridgeSettings = await readSettings();
      if (!bridgeSettings.bridgeServerId || url.searchParams.get('serverId') !== bridgeSettings.bridgeServerId) {
        return json(response, 200, { ok: true, protocol: BRIDGE_PROTOCOL, commands: [] });
      }
      return json(response, 200, { ok: true, protocol: BRIDGE_PROTOCOL, commands: bridgeOutbox.list(url.searchParams.get('limit')) });
    }
    if (request.method === 'POST' && url.pathname === '/api/bridge/ack') {
      if (!isLoopbackAddress(request.socket.remoteAddress)) return json(response, 403, { ok: false, reason: 'loopback-required' });
      try {
        const body = JSON.parse(await readBody(request));
        return json(response, 200, { ok: true, acknowledged: bridgeOutbox.acknowledge(body.ids) });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/messages') return json(response, 200, { messages: hostMessages.slice(-500) });
    if (request.method === 'GET' && url.pathname === '/api/presence') return json(response, 200, { people: activePeople() });
    if (request.method === 'GET' && url.pathname === '/api/members') return json(response, 200, { members: [...hostMembers.values()] });
    if (request.method === 'POST' && url.pathname === '/api/presence') {
      try {
        const person = JSON.parse(await readBody(request));
        const name = normalizeDisplayName(person.name);
        if (!person.id || !name) return json(response, 400, { ok: false, reason: 'invalid-person' });
        if (isNameTaken(name, person.id)) return json(response, 409, { ok: false, reason: 'name-taken' });
        const previous = hostPresence.get(String(person.id)) || {};
        const mcNickname = String(person.mcNickname || '').trim().slice(0, 16);
        const role = person.role === 'host' ? 'host' : person.role === 'temporary-host' ? 'temporary-host' : 'client';
        hostPresence.set(String(person.id), { id: String(person.id), name, avatar: normalizeAvatarId(person.avatar), avatarImage: '', mcNickname, status: isNicknameInGame(mcNickname) ? 'game' : String(person.status || 'network'), role, voiceJoined: Boolean(person.voiceJoined), voiceSpeaking: Boolean(person.voiceSpeaking), voiceDeafened: Boolean(person.voiceDeafened), micEnabled: person.micEnabled !== false, failoverEligible: person.failoverEligible !== false, publicKey: String(person.publicKey || ''), address: requestRadminAddress(request), seenAt: Date.now() });
        await rememberHostMember(person.id, name, person.avatar, mcNickname); updateTray(true);
        return json(response, 200, { ok: true });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/voice/signal') {
      try {
        const signal = JSON.parse(await readBody(request));
        if (!signal.from || !signal.to || !signal.payload) return json(response, 400, { ok: false, reason: 'invalid-signal' });
        const target = String(signal.to);
        const queue = voiceSignals.get(target) || [];
        queue.push({ from: String(signal.from), payload: signal.payload });
        voiceSignals.set(target, queue.slice(-100));
        return json(response, 202, { ok: true });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/voice/signal') {
      const target = String(url.searchParams.get('for') || '');
      if (!target) return json(response, 400, { ok: false, reason: 'missing-target' });
      const signals = voiceSignals.get(target) || [];
      voiceSignals.delete(target);
      return json(response, 200, { ok: true, signals });
    }
    if (request.method === 'POST' && url.pathname === '/api/voice/invite') {
      try {
        const invite = JSON.parse(await readBody(request));
        if (!invite.from || !invite.to || !invite.name) return json(response, 400, { ok: false, reason: 'invalid-invite' });
        const target = String(invite.to); const queue = voiceInvites.get(target) || [];
        queue.push({ id: crypto.randomUUID(), from: String(invite.from), name: String(invite.name).slice(0, 32), createdAt: Date.now() });
        voiceInvites.set(target, queue.slice(-20));
        return json(response, 202, { ok: true });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'GET' && url.pathname === '/api/voice/invite') {
      const target = String(url.searchParams.get('for') || '');
      if (!target) return json(response, 400, { ok: false, reason: 'missing-target' });
      const invites = (voiceInvites.get(target) || []).filter(invite => Date.now() - invite.createdAt < 120000);
      voiceInvites.delete(target);
      return json(response, 200, { ok: true, invites });
    }
    if (request.method === 'POST' && url.pathname === '/api/messages') {
      try {
        const { message } = JSON.parse(await readBody(request));
        if (!Array.isArray(message) || message.length < 5 || typeof message[3] !== 'string') return json(response, 400, { ok: false, reason: 'invalid-message' });
        const stored = message.slice(0, 9); if (!stored[6]) stored[6] = crypto.randomUUID();
        if (!hostMessages.some(item => item[6] === stored[6])) {
          hostMessages.push(stored);
          queueBridgeMessage(stored);
        }
        await writeMessages(hostMessages); return json(response, 201, { ok: true, message: stored });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-json' }); }
    }
    if (request.method === 'POST' && url.pathname === '/api/messages/profile') {
      try {
        const profile = JSON.parse(await readBody(request));
        if (!profile.id || !profile.name) return json(response, 400, { ok: false, reason: 'invalid-profile' });
        let changed = false;
        hostMessages = hostMessages.map(message => {
          const ownOrigin = ['app', 'host', 'sticker'].includes(message[2]);
          const matches = message[7] === profile.id || (!message[7] && ownOrigin && message[1] === profile.previousName);
          if (!matches) return message;
          const updated = [...message]; updated[0] = normalizeAvatarId(profile.avatar); updated[1] = normalizeDisplayName(profile.name); updated[7] = String(profile.id); changed = true; return updated;
        });
        const presence = hostPresence.get(String(profile.id));
        if (presence) hostPresence.set(String(profile.id), { ...presence, name: normalizeDisplayName(profile.name), avatar: normalizeAvatarId(profile.avatar), mcNickname: profile.clearMinecraftLink ? '' : presence.mcNickname, seenAt: Date.now() });
        await rememberHostMember(profile.id, profile.name, profile.avatar, profile.clearMinecraftLink ? '' : undefined);
        if (changed) await writeMessages(hostMessages);
        return json(response, 200, { ok: true, changed });
      } catch { return json(response, 400, { ok: false, reason: 'invalid-profile' }); }
    }
    // Host-only wipe of the shared history. Clients never call this; the button
    // that triggers it is hidden unless this instance is the Host.
    if (request.method === 'DELETE' && url.pathname === '/api/messages') {
      const removed = hostMessages.length;
      hostMessages = [];
      hostDeletedMessageIds.clear();
      hostChatClearedAt = Date.now();
      await writeMessages(hostMessages);
      await writeFailoverJournal();
      diagnosticLog('host.chat-cleared', { removed });
      return json(response, 200, { ok: true, removed });
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/messages/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/messages/'.length));
      const count = hostMessages.length; hostMessages = hostMessages.filter(message => message[6] !== id);
      if (hostMessages.length !== count) {
        hostDeletedMessageIds.add(id);
        await writeMessages(hostMessages);
        await writeFailoverJournal();
      }
      return json(response, 200, { ok: true, removed: count !== hostMessages.length });
    }
    return json(response, 404, { ok: false, reason: 'not-found' });
  });
  await new Promise((resolve, reject) => { hostServer.once('error', reject); hostServer.listen(hostPort, '0.0.0.0', resolve); });
  diagnosticLog('host.listening', { address: '0.0.0.0', port: hostPort, firewallAllowed });
  if (hostRuntime.role === 'primary') startServerBridge().catch(error => diagnosticLog('bridge.start-failed', { error: serializeError(error) }));
  diagnosticLog('failover.host-runtime', hostRuntime);
  return { ok: true, port: hostPort };
  })();
  try { return await hostStartPromise; }
  finally { hostStartPromise = undefined; }
}
function stopHost() {
  if (hostServer?.listening) hostServer.close();
  hostServer = undefined; hostInstanceId = ''; hostPresence.clear(); voiceSignals.clear(); voiceInvites.clear();
  hostRuntime = { role: '', communityId: '', primaryHostAddress: '', primaryDeviceId: '', term: 1 };
  activeTemporaryStatus = null;
  stopServerBridge();
  bridgeState = { connected: false, seenAt: 0, players: 0, mapPlayers: [], protocol: null, bridgeVersion: '', minecraftVersion: '', forgeVersion: '', serverKind: '' };
  updateTray(true);
}
let radminFallbackCache = { checkedAt: 0, value: null };
async function radminVpnStatus() {
  const adapters = Object.entries(os.networkInterfaces());
  const ipv4 = adapters.flatMap(([name, list]) => (list || []).map(item => ({ name, ...item })))
    .filter(item => (item.family === 'IPv4' || item.family === 4) && !item.internal && /^26\./.test(item.address));
  let radmin = ipv4.find(item => /radmin|famatech/i.test(item.name)) || ipv4[0];

  // Radmin keeps working through its service while the GUI is hidden. Use the
  // native adapter list in the common case; PowerShell is only a fallback when
  // Windows has just enabled the adapter and Node has not seen it yet.
  if (!radmin && radminFallbackCache.value && Date.now() - radminFallbackCache.checkedAt < 10000) {
    radmin = radminFallbackCache.value;
  } else if (!radmin && process.platform === 'win32' && Date.now() - radminFallbackCache.checkedAt >= 10000) {
    radminFallbackCache.checkedAt = Date.now();
    try {
      const command = "$ip=Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress -like '26.*' -and $_.AddressState -ne 'Duplicate'} | Sort-Object @{Expression={if($_.InterfaceAlias -match 'Radmin|Famatech'){0}else{1}}} | Select-Object -First 1; if($ip){$ip.InterfaceAlias+'|'+$ip.IPAddress}";
      const result = await execFileAsync('powershell.exe', ['-WindowStyle', 'Hidden', '-NoProfile', '-NonInteractive', '-Command', command], { timeout: 3000, windowsHide: true });
      const [name, address] = result.stdout.trim().split('|');
      if (address && /^26\./.test(address)) radmin = { name: name || 'Radmin VPN', address };
      radminFallbackCache.value = radmin || null;
    } catch { radminFallbackCache.value = null; }
  }

  return { detected: Boolean(radmin), adapterDetected: Boolean(radmin), guiRunning: null, address: radmin ? `${radmin.address}:${hostPort}` : '', adapter: radmin?.name || '', reason: radmin ? '' : 'adapter-missing' };
}
async function lanAddress() {
  const radmin = await radminVpnStatus();
  return radmin.detected ? radmin.address : '';
}
async function fetchWithTimeout(url, options = {}) {
  const signal = AbortSignal.timeout(3500);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  return fetch(url, { ...options, signal, headers });
}
let vpnMissStreak = 0;
let lastVpnAddress = '';

const statusFromHealth = (mode, address, body) => ({
  ok: true,
  mode,
  address,
  serverName: body.serverName,
  mcVersion: String(body.mcVersion || defaults.mcVersion),
  instanceId: body.instanceId || '',
  mapPort: Number(body.mapPort) || 8100,
  mapUrl: body.mapUrl || '',
  modsUrl: String(body.modsUrl || ''),
  communityId: String(body.communityId || ''),
  hostRole: String(body.hostRole || (mode === 'host' ? 'primary' : '')),
  currentHostDeviceId: String(body.currentHostDeviceId || ''),
  term: Math.max(1, Number(body.term) || 1)
});

async function probeHostHealth(address, timeout = 3500) {
  const clean = cleanAddress(address);
  if (!clean) return { ok: false, reason: 'invalid-address' };
  try {
    const response = await fetch(`${hostUrl(clean)}/api/health`, {
      signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json' }
    });
    const body = await response.json();
    return response.ok && body.ok ? { ok: true, address: clean, body } : { ok: false, reason: 'unavailable' };
  } catch (error) {
    return { ok: false, reason: String(error?.cause?.code || error?.code || 'unreachable').toLowerCase() };
  }
}

async function recoverPrimary(primaryProbe) {
  const settings = await readSettings();
  const failoverState = await readFailoverState();
  const stored = failoverState.communities?.[settings.communityId];
  const pendingRecovery = hostRuntime.role === 'temporary' || Boolean(stored?.pendingRecovery);
  if (!pendingRecovery) return true;
  try {
    if (!hostMessages.length) hostMessages = await readMessages();
    if (!hostMembers.size) await loadHostMembers();
    const response = await fetch(`${hostUrl(primaryProbe.address)}/api/failover/recover`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        communityId: hostRuntime.communityId || settings.communityId,
        term: hostRuntime.role === 'temporary' ? hostRuntime.term : Math.max(2, Number(stored?.temporaryTerm) || 2),
        messages: hostMessages,
        members: [...hostMembers.values()],
        deletedMessageIds: [...hostDeletedMessageIds],
        chatClearedAt: hostChatClearedAt
      })
    });
    if (!response.ok) return false;
    if (hostRuntime.role === 'temporary') stopHost();
    await writeFailoverState({
      communities: {
        [settings.communityId]: {
          ...stored,
          pendingRecovery: false,
          temporaryTerm: 0,
          failureSince: 0,
          lastPrimarySeenAt: Date.now()
        }
      }
    });
    diagnosticLog('failover.returned-to-primary', { address: primaryProbe.address });
    return true;
  } catch (error) {
    diagnosticLog('failover.recovery-failed', { error: serializeError(error) });
    return false;
  }
}

async function temporaryHostStatus(settings) {
  const identity = await readIdentity();
  const state = await readFailoverState();
  const communityId = settings.communityId;
  const descriptor = state.communities?.[communityId];
  if (!descriptor || descriptor.enabled === false || !verifyDescriptor(descriptor)) return null;

  const now = Date.now();
  primaryFailureSince ||= Number(descriptor.failureSince) || now;
  if (!descriptor.failureSince) {
    await writeFailoverState({ communities: { [communityId]: { ...descriptor, failureSince: primaryFailureSince } } });
  }

  if (hostRuntime.role === 'temporary' && hostRuntime.communityId === communityId && hostServer?.listening) {
    return {
      ok: true,
      mode: 'temporary-host',
      address: `127.0.0.1:${hostPort}`,
      serverName: settings.serverName,
      mcVersion: settings.mcVersion || defaults.mcVersion,
      mapPort: Number(settings.mapPort) || 8100,
      mapUrl: '',
      modsUrl: settings.modsUrl || '',
      communityId,
      hostRole: 'temporary',
      currentHostDeviceId: identity.deviceId,
      term: hostRuntime.term
    };
  }

  const candidates = rankCandidates(descriptor.candidates);
  const selfIndex = candidates.findIndex(candidate => candidate.deviceId === identity.deviceId);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.deviceId === identity.deviceId) continue;
    const probe = await probeHostHealth(candidate.address, 900);
    if (probe.ok &&
        probe.body.hostRole === 'temporary' &&
        probe.body.communityId === communityId &&
        Number(probe.body.term) > Number(descriptor.term || 1)) {
      return statusFromHealth('client', candidate.address, probe.body);
    }
    if (selfIndex >= 0 && index < selfIndex && !canPromote({
      candidates,
      deviceId: identity.deviceId,
      failureSince: primaryFailureSince,
      now
    })) break;
  }

  if (settings.temporaryHostEligible !== false && canPromote({
    candidates,
    deviceId: identity.deviceId,
    failureSince: primaryFailureSince,
    now
  })) {
    try {
      await startHost({ role: 'temporary', descriptor });
      await writeFailoverState({
        communities: {
          [communityId]: {
            ...descriptor,
            primaryHostAddress: cleanAddress(descriptor.primaryHostAddress),
            failureSince: primaryFailureSince,
            pendingRecovery: true,
            temporaryTerm: hostRuntime.term
          }
        }
      });
      diagnosticLog('failover.promoted', { communityId, deviceId: identity.deviceId, term: hostRuntime.term });
      return temporaryHostStatus(settings);
    } catch (error) {
      diagnosticLog('failover.promotion-failed', { error: serializeError(error) });
    }
  }
  return null;
}

function schedulePrimaryRecovery(settings, primaryAddress) {
  if (recoveryProbeRunning || Date.now() - lastRecoveryProbeAt < 5000) return;
  recoveryProbeRunning = true;
  lastRecoveryProbeAt = Date.now();
  (async () => {
    const primary = await probeHostHealth(primaryAddress, 1800);
    if (primary.ok && primary.body.hostRole !== 'temporary') {
      if (await recoverPrimary(primary)) {
        if (primary.body.failover) await rememberFailoverDescriptor(primary.body.failover, primaryAddress);
        activeTemporaryStatus = null;
        primaryFailureSince = 0;
      }
      return;
    }
    if (activeTemporaryStatus?.mode === 'client') {
      const temporary = await probeHostHealth(activeTemporaryStatus.address, 1200);
      if (!temporary.ok || temporary.body.hostRole !== 'temporary') activeTemporaryStatus = null;
    }
  })().catch(error => diagnosticLog('failover.background-probe-failed', { error: serializeError(error) }))
    .finally(() => { recoveryProbeRunning = false; });
}

async function lanStatus() {
  const settings = await readSettings();
  const vpn = await radminVpnStatus();
  if (vpn.detected) { vpnMissStreak = 0; lastVpnAddress = vpn.address; }
  if (!vpn.detected) {
    vpnMissStreak += 1;
    // A single flaky adapter read (os.networkInterfaces momentarily missing the
    // Radmin adapter, or the PowerShell fallback timing out) used to tear the
    // host down, wiping presence and blinking it out of everyone's online list.
    // Keep a listening host alive through brief misses; only give up after ~20s
    // of consecutive failures.
    // A listening local TCP socket is not a working RadminCraft Host when the
    // VPN adapter is offline. Report the real state immediately so the header,
    // voice channel and all client APIs cannot claim that the Host is online.
    // The process itself is kept alive for a few misses to avoid needlessly
    // rebuilding state when Windows briefly refreshes the adapter list.
    if (settings.mode === 'host' && vpnMissStreak >= 4) stopHost();
    return { ok: false, mode: settings.mode, reason: 'radmin-vpn-unavailable', vpnReason: vpn.reason };
  }
  if (settings.mode === 'host') { try { await startHost(); return { ok: true, mode: 'host', address: vpn.address, serverName: settings.serverName, mcVersion: settings.mcVersion || defaults.mcVersion, mapPort: Number(settings.mapPort) || 8100, mapUrl: settings.mapUrl || '', modsUrl: settings.modsUrl || '', communityId: hostRuntime.communityId, hostRole: 'primary', currentHostDeviceId: hostRuntime.primaryDeviceId, term: hostRuntime.term }; } catch (error) { diagnosticLog('host.start-failed', { error: serializeError(error), vpn }); return { ok: false, mode: 'host', reason: error.code === 'EADDRINUSE' ? 'port-in-use' : error.code === 'RADMIN_VPN_UNAVAILABLE' ? 'radmin-vpn-unavailable' : 'host-start-failed' }; } }
  if (!settings.hostAddress) return { ok: false, mode: 'client', reason: 'no-address' };
  const primaryAddress = cleanAddress(settings.primaryHostAddress || settings.hostAddress);
  if (activeTemporaryStatus) {
    schedulePrimaryRecovery(settings, primaryAddress);
    return activeTemporaryStatus;
  }
  const primary = await probeHostHealth(primaryAddress);
  if (primary.ok && primary.body.hostRole !== 'temporary') {
    if (hostRuntime.role === 'temporary' && !await recoverPrimary(primary)) {
      return temporaryHostStatus(settings) || { ok: false, mode: 'client', reason: 'recovery-failed' };
    }
    if (primary.body.failover) {
      const accepted = await rememberFailoverDescriptor(primary.body.failover, primaryAddress);
      if (!accepted.ok) {
        diagnosticLog('failover.descriptor-rejected', { reason: accepted.reason, address: primaryAddress });
        return { ok: false, mode: 'client', reason: accepted.reason };
      }
    }
    return statusFromHealth('client', primaryAddress, primary.body);
  }
  diagnosticLog('client.host-unreachable', { address: primaryAddress, reason: primary.reason });
  const temporary = await temporaryHostStatus(settings);
  if (temporary) activeTemporaryStatus = temporary;
  return temporary || { ok: false, mode: 'client', reason: primaryFailureSince ? 'failover-waiting' : 'unreachable' };
}
async function lanMessages() {
  const status = await lanStatus(); if (!status.ok) return { ok: false, reason: status.reason, messages: [] };
  try {
    const response = await fetchWithTimeout(`${status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address)}/api/messages`);
    const body = await response.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (response.ok && status.mode === 'client') await writeMessages(messages);
    return { ok: response.ok, messages };
  }
  catch { return { ok: false, reason: 'sync-failed', messages: [] }; }
}
async function minecraftLinkRequest() {
  const [status, identity] = await Promise.all([lanStatus(), readIdentity()]);
  if (!status.ok) return { ok: false, reason: status.reason };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const base = status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address);
  try {
    const response = await fetchWithTimeout(`${base}/api/minecraft-link/request`, {
      method: 'POST',
      body: JSON.stringify({ deviceId: identity.deviceId, code })
    });
    return response.ok
      ? { ok: true, code, command: `!radmincraft link ${code}`, expiresAt: Date.now() + 5 * 60 * 1000 }
      : { ok: false, reason: 'request-rejected' };
  } catch { return { ok: false, reason: 'request-failed' }; }
}
async function minecraftLinkStatus(code) {
  const [status, identity] = await Promise.all([lanStatus(), readIdentity()]);
  if (!status.ok) return { ok: false, reason: status.reason };
  const base = status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address);
  try {
    const response = await fetchWithTimeout(`${base}/api/minecraft-link/status?code=${encodeURIComponent(code)}&deviceId=${encodeURIComponent(identity.deviceId)}`);
    const body = await response.json();
    if (response.ok && body.linked && body.mcNickname) {
      await writeSettings({ mcNickname: String(body.mcNickname).slice(0, 16) });
      return { ok: true, linked: true, mcNickname: body.mcNickname };
    }
    return { ok: response.ok, linked: false, reason: body.reason || '' };
  } catch { return { ok: false, linked: false, reason: 'status-failed' }; }
}
async function minecraftLinkCancel(code) {
  const [status, identity] = await Promise.all([lanStatus(), readIdentity()]);
  if (!status.ok) return { ok: false, reason: status.reason };
  const base = status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address);
  try {
    const response = await fetchWithTimeout(`${base}/api/minecraft-link/request?code=${encodeURIComponent(code)}&deviceId=${encodeURIComponent(identity.deviceId)}`, { method: 'DELETE' });
    return { ok: response.ok };
  } catch { return { ok: false, reason: 'cancel-failed' }; }
}
async function lanSendMessage(message) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, reason: status.reason };
  if (status.mode === 'host') { const stored = message.slice(0, 9); if (!stored[6]) stored[6] = crypto.randomUUID(); if (!hostMessages.some(item => item[6] === stored[6])) { hostMessages.push(stored); queueBridgeMessage(stored); } await writeMessages(hostMessages); return { ok: true, message: stored }; }
  try { const response = await fetchWithTimeout(`${hostUrl(status.address)}/api/messages`, { method: 'POST', body: JSON.stringify({ message }) }); const body = await response.json(); return response.ok ? { ok: true, message: body.message } : { ok: false, reason: 'rejected' }; }
  catch { return { ok: false, reason: 'send-failed' }; }
}
async function lanUpdateMessageProfile(profile) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, reason: status.reason };
  if (status.mode === 'host') {
    let changed = false;
    hostMessages = hostMessages.map(message => {
      const ownOrigin = ['app', 'host', 'sticker'].includes(message[2]);
      const matches = message[7] === profile.id || (!message[7] && ownOrigin && message[1] === profile.previousName);
      if (!matches) return message;
      const updated = [...message]; updated[0] = normalizeAvatarId(profile.avatar); updated[1] = normalizeDisplayName(profile.name); updated[7] = String(profile.id); changed = true; return updated;
    });
    const presence = hostPresence.get(String(profile.id));
    if (presence) hostPresence.set(String(profile.id), { ...presence, name: normalizeDisplayName(profile.name), avatar: normalizeAvatarId(profile.avatar), mcNickname: profile.clearMinecraftLink ? '' : presence.mcNickname, seenAt: Date.now() });
    await rememberHostMember(profile.id, profile.name, profile.avatar, profile.clearMinecraftLink ? '' : undefined);
    if (changed) await writeMessages(hostMessages);
    return { ok: true, changed };
  }
  try { const response = await fetchWithTimeout(`${hostUrl(status.address)}/api/messages/profile`, { method: 'POST', body: JSON.stringify(profile) }); return { ok: response.ok }; }
  catch { return { ok: false, reason: 'profile-sync-failed' }; }
}
async function lanDeleteMessage(id) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, reason: status.reason };
  if (status.mode === 'host') {
    hostMessages = hostMessages.filter(message => message[6] !== id);
    hostDeletedMessageIds.add(id);
    await writeMessages(hostMessages);
    await writeFailoverJournal();
    return { ok: true };
  }
  try { const response = await fetchWithTimeout(`${hostUrl(status.address)}/api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }); return { ok: response.ok }; }
  catch { return { ok: false, reason: 'delete-failed' }; }
}
// Only the Host may wipe the shared history: a client clearing its own copy
// would just resync it from the Host on the next poll.
async function lanClearMessages() {
  const settings = await readSettings();
  if (settings.mode !== 'host') return { ok: false, reason: 'not-host' };
  const status = await lanStatus();
  if (!status.ok) return { ok: false, reason: status.reason };
  const removed = hostMessages.length;
  hostMessages = [];
  hostDeletedMessageIds.clear();
  hostChatClearedAt = Date.now();
  await writeMessages(hostMessages);
  await writeFailoverJournal();
  diagnosticLog('host.chat-cleared', { removed, via: 'ipc' });
  return { ok: true, removed };
}

async function lanPresence(person) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, reason: status.reason };
  const name = normalizeDisplayName(person.name);
  if (!name) return { ok: false, reason: 'invalid-name' };
  if (status.mode === 'host') { if (isNameTaken(name, person.id)) return { ok: false, reason: 'name-taken' }; const previous = hostPresence.get(String(person.id)) || {}; const mcNickname = String(person.mcNickname || '').trim().slice(0, 16); hostPresence.set(String(person.id), { ...previous, ...person, name, avatar: normalizeAvatarId(person.avatar), avatarImage: '', mcNickname, status: isNicknameInGame(mcNickname) ? 'game' : String(person.status || 'network'), voiceJoined: Boolean(person.voiceJoined), voiceSpeaking: Boolean(person.voiceSpeaking), voiceDeafened: Boolean(person.voiceDeafened), micEnabled: person.micEnabled !== false, seenAt: Date.now() }); await rememberHostMember(person.id, name, person.avatar, mcNickname); updateTray(true); return { ok: true }; }
  try {
    const [settings, identity] = await Promise.all([readSettings(), readIdentity()]);
    const response = await fetchWithTimeout(`${hostUrl(status.address)}/api/presence`, {
      method: 'POST',
      body: JSON.stringify({
        ...person,
        name,
        role: status.mode === 'temporary-host' ? 'temporary-host' : person.role,
        failoverEligible: settings.temporaryHostEligible !== false && settings.temporaryHostPrepared === true,
        publicKey: identity.publicKey
      })
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, reason: body.reason || (response.ok ? '' : 'presence-rejected') };
  }
  catch { return { ok: false, reason: 'presence-failed' }; }
}
async function lanCheckDisplayName(candidate) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, available: false, reason: status.reason };
  const name = normalizeDisplayName(candidate?.name);
  if (!name) return { ok: false, available: false, reason: 'invalid-name' };
  if (status.mode === 'host') return { ok: true, available: !isNameTaken(name, candidate?.id), name };
  try { const response = await fetchWithTimeout(`${hostUrl(status.address)}/api/profile/name-check`, { method: 'POST', body: JSON.stringify({ id: candidate?.id, name }) }); const body = await response.json(); return { ok: response.ok, available: Boolean(body.available), reason: body.reason || '', name: body.name || name }; }
  catch { return { ok: false, available: false, reason: 'name-check-failed' }; }
}
async function lanPeople() {
  const status = await lanStatus(); if (!status.ok) return { ok: false, people: [] };
  if (status.mode === 'host') return { ok: true, people: activePeople() };
  try { const response = await fetchWithTimeout(`${hostUrl(status.address)}/api/presence`); const body = await response.json(); return { ok: response.ok, people: Array.isArray(body.people) ? body.people : [] }; }
  catch { return { ok: false, people: [] }; }
}
async function lanBridgeStatus() {
  const status = await lanStatus(); if (!status.ok) return { ok: false, connected: false, mapPlayers: [] };
  const base = status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address);
  try { const response = await fetchWithTimeout(`${base}/api/bridge/status`); const body = await response.json(); return { ok: response.ok, connected: Boolean(body.connected), linkAvailable: Boolean(body.linkAvailable), players: Number(body.players) || 0, playerNames: Array.isArray(body.playerNames) ? body.playerNames.map(name => String(name).slice(0, 16)).filter(Boolean) : [], mapPlayers: Array.isArray(body.mapPlayers) ? body.mapPlayers : [] }; }
  catch { return { ok: false, connected: false, linkAvailable: false, playerNames: [], mapPlayers: [] }; }
}
async function installForgeBridge() {
  const settings = await readSettings();
  if (settings.mode !== 'host') return { ok: false, reason: 'not-host' };
  const serverPath = String(settings.serverPath || '').trim();
  if (!serverPath) return { ok: false, reason: 'server-path-missing' };
  const version = String(settings.mcVersion || '').match(/\d+\.\d+(?:\.\d+)?/)?.[0] || '';
  if (!version) return { ok: false, reason: 'minecraft-version-missing' };
  const sourceDir = app.isPackaged
    ? path.join(process.resourcesPath, 'forge-bridge')
    : path.join(__dirname, '..', 'forge-bridge', 'dist');
  try {
    const files = await fs.readdir(sourceDir);
    const file = files.find(name => name.includes(`Forge-${version}-`) && name.endsWith('.jar'));
    if (!file) return { ok: false, reason: 'unsupported-version', version };
    const modsDir = path.join(serverPath, 'mods');
    await fs.mkdir(modsDir, { recursive: true });
    const target = path.join(modsDir, file);
    await fs.copyFile(path.join(sourceDir, file), target);
    diagnosticLog('bridge.mod-installed', { version, target });
    return { ok: true, version, file, target };
  } catch (error) {
    diagnosticLog('bridge.mod-install-failed', { version, error: serializeError(error) });
    return { ok: false, reason: 'copy-failed' };
  }
}
async function lanMapInfo() {
  const status = await lanStatus();
  if (!status.ok) return { ok: false, reachable: false, reason: status.reason || 'host-unavailable' };
  const settings = await readSettings();
  const port = Math.max(1, Math.min(65535, Number(status.mapPort || settings.mapPort) || 8100));
  let mapUrl = String(status.mapUrl || '').trim();
  const customUrl = mapUrl;
  if (!mapUrl) {
    const base = status.mode === 'host' ? '127.0.0.1' : new URL(hostUrl(status.address)).hostname;
    mapUrl = `http://${base}:${port}/`;
  }
  if (!/^https?:\/\//i.test(mapUrl)) mapUrl = `http://${mapUrl}`;
  try { const parsed = new URL(mapUrl); if (!parsed.port) { parsed.port = String(port); mapUrl = parsed.toString(); } } catch {}
  if (!mapUrl.endsWith('/')) mapUrl += '/';
  try {
    const response = await fetch(mapUrl, { signal: AbortSignal.timeout(2800) });
    return { ok: true, reachable: response.ok, url: mapUrl, customUrl, port, mode: status.mode, reason: response.ok ? '' : `http-${response.status}` };
  } catch { return { ok: true, reachable: false, url: mapUrl, customUrl, port, mode: status.mode, reason: 'bluemap-unreachable' }; }
}
async function lanVoiceSignal(signal) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, reason: status.reason };
  const base = status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address);
  try { const response = await fetchWithTimeout(`${base}/api/voice/signal`, { method: 'POST', body: JSON.stringify(signal) }); return { ok: response.ok }; }
  catch { return { ok: false, reason: 'signal-failed' }; }
}
async function lanVoiceSignals(deviceId) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, signals: [] };
  const base = status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address);
  try { const response = await fetchWithTimeout(`${base}/api/voice/signal?for=${encodeURIComponent(deviceId)}`); const body = await response.json(); return { ok: response.ok, signals: Array.isArray(body.signals) ? body.signals : [] }; }
  catch { return { ok: false, signals: [] }; }
}
async function lanVoiceInvite(invite) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, reason: status.reason };
  const base = status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address);
  try { const response = await fetchWithTimeout(`${base}/api/voice/invite`, { method: 'POST', body: JSON.stringify(invite) }); return { ok: response.ok }; }
  catch { return { ok: false, reason: 'invite-failed' }; }
}
async function lanVoiceInvites(deviceId) {
  const status = await lanStatus(); if (!status.ok) return { ok: false, invites: [] };
  const base = status.mode === 'host' ? `http://127.0.0.1:${hostPort}` : hostUrl(status.address);
  try { const response = await fetchWithTimeout(`${base}/api/voice/invite?for=${encodeURIComponent(deviceId)}`); const body = await response.json(); return { ok: response.ok, invites: Array.isArray(body.invites) ? body.invites : [] }; }
  catch { return { ok: false, invites: [] }; }
}

// --- Network diagnostics -------------------------------------------------
// Distinguishes VPN-peer reachability from TCP Host reachability so the UI can
// tell the user *where* the connection breaks. It never restarts the Radmin VPN
// service or adapter: per the owner's decision that must stay a manual action.
function tcpProbe(hostname, port, timeout = 3500) {
  return new Promise(resolve => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok, reason) => { if (settled) return; settled = true; socket.destroy(); resolve({ ok, reason, ms: Date.now() - started }); };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true, ''));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', error => finish(false, error.code === 'ECONNREFUSED' ? 'refused' : String(error.code || 'error').toLowerCase()));
    try { socket.connect(port, hostname); } catch { finish(false, 'invalid-address'); }
  });
}

async function pingProbe(hostname) {
  if (!hostname) return { ok: false, reason: 'no-address' };
  if (process.platform !== 'win32') return { ok: null, reason: 'unsupported-platform' };
  try {
    const result = await execFileAsync('powershell.exe', ['-WindowStyle', 'Hidden', '-NoProfile', '-NonInteractive', '-Command',
      "$ok=Test-Connection -ComputerName $env:RC_PING_TARGET -Count 2 -Quiet -ErrorAction SilentlyContinue; if($ok){'1'}else{'0'}"],
      { timeout: 8000, windowsHide: true, env: { ...process.env, RC_PING_TARGET: hostname } });
    return { ok: result.stdout.trim() === '1', reason: result.stdout.trim() === '1' ? '' : 'no-reply' };
  } catch (error) { return { ok: false, reason: error.code === 'ETIMEDOUT' ? 'timeout' : 'ping-failed' }; }
}

async function localPortState(port) {
  if (hostServer?.listening) return { ok: true, reason: 'listening-self' };
  const probe = await tcpProbe('127.0.0.1', port, 1500);
  return probe.ok ? { ok: false, reason: 'busy-other' } : { ok: true, reason: 'free' };
}

async function runNetworkDiagnostics() {
  const settings = await readSettings();
  const mode = settings.mode || 'client';
  const vpn = await radminVpnStatus();
  const steps = [];
  const localAddress = vpn.detected ? vpn.address.replace(/:\d+$/, '') : '';

  steps.push({
    id: 'adapter',
    label: 'Адаптер Radmin VPN',
    status: vpn.detected ? 'ok' : 'fail',
    detail: vpn.detected ? `${vpn.adapter || 'Radmin VPN'} · ${localAddress}` : 'Адрес 26.* не найден',
    hint: vpn.detected ? '' : 'Запустите Radmin VPN и убедитесь, что у сети есть адрес вида 26.x.x.x. RadminCraft не перезапускает VPN автоматически.'
  });

  if (mode === 'host') {
    const mapPort = Math.max(1, Math.min(65535, Number(settings.mapPort) || 8100));
    const port = await localPortState(hostPort);
    steps.push({
      id: 'port',
      label: `Локальный порт ${hostPort}`,
      status: port.ok ? 'ok' : 'fail',
      detail: port.reason === 'listening-self' ? 'Host слушает порт' : port.reason === 'free' ? 'Порт свободен, Host ещё не запущен' : 'Порт занят другой программой',
      hint: port.reason === 'busy-other' ? `Другой процесс уже держит порт ${hostPort}. Закройте вторую копию RadminCraft или программу, занявшую порт.` : ''
    });
    const firewall = vpn.detected && process.platform === 'win32' ? await hasWindowsFirewallAccess(mapPort) : true;
    steps.push({
      id: 'firewall',
      label: 'Правило брандмауэра',
      status: firewall ? 'ok' : 'warn',
      detail: firewall ? `Порты ${hostPort}, ${mapPort} разрешены для 26.0.0.0/8` : 'Разрешающее правило не найдено',
      hint: firewall ? '' : 'Нажмите «Разрешить в брандмауэре» в настройках подключения (потребуется подтверждение UAC).'
    });
  } else {
    const target = settings.hostAddress ? parseHostTarget(settings.hostAddress) : null;
    steps.push({
      id: 'host-address',
      label: 'Адрес Host',
      status: target ? 'ok' : 'fail',
      detail: target ? `${target.hostname}:${target.port}` : 'Не задан',
      hint: target ? '' : 'Откройте мастер настройки и укажите адрес компьютера Host в сети Radmin VPN.'
    });

    if (target && vpn.detected) {
      const ping = await pingProbe(target.hostname);
      steps.push({
        id: 'peer',
        label: 'Доступность Host в Radmin VPN (ping)',
        status: ping.ok === true ? 'ok' : ping.ok === null ? 'skip' : 'fail',
        detail: ping.ok === true ? 'Host отвечает на ping' : ping.ok === null ? 'Проверка доступна только на Windows' : 'Host не отвечает на ping',
        hint: ping.ok === false ? 'Компьютер Host не виден внутри Radmin VPN. Проверьте, что у обоих одна сеть Radmin и Host включён. Пока ping не проходит, чат работать не будет.' : ''
      });

      const tcp = await tcpProbe(target.hostname, target.port);
      steps.push({
        id: 'tcp',
        label: `TCP-порт ${target.port} на Host`,
        status: tcp.ok ? 'ok' : ping.ok === false ? 'skip' : 'fail',
        detail: tcp.ok ? `Порт открыт (${tcp.ms} мс)` : tcp.reason === 'refused' ? 'Соединение отклонено' : tcp.reason === 'timeout' ? 'Таймаут соединения' : `Ошибка: ${tcp.reason}`,
        hint: tcp.ok ? '' : ping.ok === false ? 'Сначала восстановите видимость Host в Radmin VPN.' : tcp.reason === 'refused' ? 'Host виден в сети, но RadminCraft на нём не запущен. Попросите Host открыть приложение.' : 'Host виден в сети, но порт закрыт. Проверьте брандмауэр на компьютере Host.'
      });

      if (tcp.ok) {
        let http = { ok: false, reason: 'unreachable', serverName: '' };
        try { const response = await fetchWithTimeout(`${hostUrl(settings.hostAddress)}/api/health`); const body = await response.json().catch(() => ({})); http = { ok: response.ok && body.ok, reason: response.ok ? '' : `http-${response.status}`, serverName: body.serverName || '' }; }
        catch { http = { ok: false, reason: 'no-response', serverName: '' }; }
        steps.push({
          id: 'http',
          label: 'Ответ приложения Host',
          status: http.ok ? 'ok' : 'fail',
          detail: http.ok ? `Сервер «${http.serverName || 'RadminCraft'}» отвечает` : 'Приложение Host не отвечает корректно',
          hint: http.ok ? '' : 'Порт открыт, но RadminCraft на Host не отдаёт данные. Обновите обе стороны до одной версии.'
        });
      }
    }
  }

  const failedCount = steps.filter(step => step.status === 'fail').length;
  const summary = diagnosticsSummary(steps);
  const result = { time: new Date().toISOString(), mode, address: localAddress, hostAddress: mode === 'client' ? String(settings.hostAddress || '') : '', steps, summary, ok: !failedCount };
  diagnosticLog('diagnostics.network-run', { mode, summary, steps: steps.map(step => ({ id: step.id, status: step.status })) });
  return result;
}

async function readIdentity() {
  try { return JSON.parse(await fs.readFile(identityPath(), 'utf8')); }
  catch {
    const pair = crypto.generateKeyPairSync('ed25519');
    const identity = {
      deviceId: crypto.randomUUID(),
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      createdAt: new Date().toISOString()
    };
    await fs.mkdir(path.dirname(identityPath()), { recursive: true });
    await fs.writeFile(identityPath(), JSON.stringify(identity, null, 2), 'utf8');
    return identity;
  }
}

async function requestQuit() {
  const settings = await readSettings();
  if (settings.mode === 'host' && !quitApproved) {
    mainWindow?.show();
    mainWindow?.focus();
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Остановить RadminCraft Host?',
      message: 'Сообщество перестанет работать',
      detail: 'После выхода участники потеряют общий чат, голосовой канал, карту и подключение к Forge Bridge.',
      buttons: ['Оставить Host запущенным', 'Остановить Host и выйти'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (answer.response !== 1) return;
  }
  quitApproved = true;
  stopHost();
  app.quit();
}

function createWindow() {
  const captureSize = String(process.env.RADMINCRAFT_CAPTURE_SIZE || '').match(/^(\d+)x(\d+)$/);
  const window = new BrowserWindow({
    width: captureSize ? Number(captureSize[1]) : 1180,
    height: captureSize ? Number(captureSize[2]) : 760,
    minWidth: 900, minHeight: 620, title: 'RadminCraft', autoHideMenuBar: true,
    icon: appIconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  window.setMenu(null);
  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  // Opt-in visual regression hook used by maintainers. It is inert in normal
  // builds and lets CI capture the real Electron renderer without mock HTML.
  if (process.env.RADMINCRAFT_CAPTURE_SETTINGS) {
    window.webContents.once('did-finish-load', async () => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      const capturePage = String(process.env.RADMINCRAFT_CAPTURE_PAGE || 'settings');
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('.setup-backdrop')?.remove();
        document.body.classList.remove('boot-pending');
        if ("${capturePage}" === "server-setup") {
          const badge = document.querySelector('.server-setup-badge');
          if (badge) { badge.hidden = false; badge.click(); }
        } else {
          document.querySelector('[data-page="${capturePage}"]')?.click();
        }
      })()`);
      await new Promise(resolve => setTimeout(resolve, 500));
      if (capturePage === 'server-setup') {
        await window.webContents.executeJavaScript(`document.querySelector('.server-setup [data-next]')?.click()`);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const captureTab = String(process.env.RADMINCRAFT_CAPTURE_TAB || 'general');
      if (capturePage === 'settings') await window.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('.settings-tabs [data-tab="${captureTab}"]');
        if (button) button.hidden = false;
        button?.click();
      })()`);
      await new Promise(resolve => setTimeout(resolve, 250));
      await window.webContents.executeJavaScript(`document.querySelectorAll('.setup-backdrop').forEach(element => element.remove())`);
      if (process.env.RADMINCRAFT_CAPTURE_SCROLL === 'devices') {
        await window.webContents.executeJavaScript(`document.querySelector('.audio-device-grid')?.scrollIntoView({ block: 'center' })`);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (process.env.RADMINCRAFT_CAPTURE_METRICS) {
        const metrics = await window.webContents.executeJavaScript(`(() => {
          const pane = document.querySelector('.settings-pane:not([hidden])');
          const controls = document.querySelector('.sound-setting-controls');
          const test = document.querySelector('.sound-test');
          const page = document.querySelector('#settings');
          const box = element => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right }, overflowX: style.overflowX, grid: style.gridTemplateColumns, width: style.width, minWidth: style.minWidth, color: style.color, background: style.backgroundColor };
          };
          const deviceSelects = [...document.querySelectorAll('.audio-device-grid select')].map(select => {
            const rect = select.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return { disabled: select.disabled, options: select.options.length, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, pointerEvents: getComputedStyle(select).pointerEvents, hit: hit ? { tag: hit.tagName, className: hit.className } : null };
          });
          return { page: box(page), pane: box(pane), controls: box(controls), test: box(test), deviceSelects, bodyScrollWidth: document.body.scrollWidth, bodyClientWidth: document.body.clientWidth };
        })()`);
        fsSync.writeFileSync(process.env.RADMINCRAFT_CAPTURE_METRICS, JSON.stringify(metrics, null, 2));
      }
      const image = await window.webContents.capturePage();
      fsSync.writeFileSync(process.env.RADMINCRAFT_CAPTURE_SETTINGS, image.toPNG());
      quitApproved = true;
      app.quit();
    });
  }
  window.webContents.on('render-process-gone', (_, details) => diagnosticLog('renderer.process-gone', { details }));
  window.on('unresponsive', () => diagnosticLog('renderer.unresponsive'));
  window.webContents.on('context-menu', (_, params) => {
    if (!params.isEditable) return;
    const text = clipboard.readText();
    Menu.buildFromTemplate([{ label: 'Вставить', role: 'paste', enabled: Boolean(text) }]).popup({ window });
  });
  window.on('close', event => {
    if (quitApproved) return;
    event.preventDefault();
    window.hide();
  });
  mainWindow = window;
  return window;
}

// ─── Notification overlay ───────────────────────────────────────────────
// RadminCraft draws its own toasts instead of using Windows notifications, so
// they carry the app's design. They live in a frameless transparent window that
// floats above every other window — including while RadminCraft is minimised or
// sitting in the tray. The window is shown inactive so it never steals focus or
// interrupts typing in a game.
const TOAST_WIDTH = 384;
const TOAST_MARGIN = 16;
let toastWindow;
let toastReady = false;
const pendingToasts = [];

function toastAnchor(height) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width: TOAST_WIDTH,
    height: Math.max(1, Math.round(height)),
    x: area.x + area.width - TOAST_WIDTH - TOAST_MARGIN,
    y: area.y + area.height - Math.max(1, Math.round(height)) - TOAST_MARGIN
  };
}

function ensureToastWindow() {
  if (toastWindow && !toastWindow.isDestroyed()) return toastWindow;
  toastReady = false;
  toastWindow = new BrowserWindow({
    ...toastAnchor(120),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-toast.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // 'screen-saver' keeps the overlay above fullscreen windows and other
  // always-on-top apps, which is what makes it usable while playing.
  toastWindow.setAlwaysOnTop(true, 'screen-saver');
  toastWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  toastWindow.loadFile(path.join(__dirname, '..', 'src', 'toast.html'));
  toastWindow.webContents.once('did-finish-load', () => {
    toastReady = true;
    while (pendingToasts.length) toastWindow.webContents.send('toast:add', pendingToasts.shift());
  });
  toastWindow.on('closed', () => { toastWindow = undefined; toastReady = false; });
  return toastWindow;
}

async function showDesktopNotification(payload) {
  const settings = await readSettings();
  if (!settings.notificationsEnabled) return { ok: false, reason: 'disabled' };
  const toast = {
    id: crypto.randomUUID(),
    kind: ['join', 'mention', 'voice', 'message'].includes(payload?.kind) ? payload.kind : 'message',
    title: String(payload?.title || 'RadminCraft').slice(0, 80),
    body: String(payload?.body || '').slice(0, 180),
    page: ['chat', 'voice', 'map', 'settings'].includes(payload?.page) ? payload.page : 'chat'
  };
  try {
    const window = ensureToastWindow();
    if (toastReady) window.webContents.send('toast:add', toast);
    else pendingToasts.push(toast);
    return { ok: true };
  } catch (error) {
    diagnosticLog('notification.failed', { error: serializeError(error) });
    return { ok: false, reason: 'failed' };
  }
}

function updateTray(enabled) {
  if (!enabled) { tray?.destroy(); tray = undefined; return; }
  if (!tray) {
    const image = nativeImage.createFromPath(appIconPath).resize({ width: 32, height: 32, quality: 'best' });
    tray = new Tray(image);
    tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  }
  readSettings().then(settings => {
    if (!tray) return;
    const isHost = settings.mode === 'host' && Boolean(hostServer?.listening);
    // A Host counts its own presence table; a client is fed the numbers by the
    // renderer, which already polls /api/presence.
    const activePeople = [...hostPresence.values()].filter(person => Date.now() - person.seenAt < 90000);
    const online = isHost ? activePeople.length : widgetState.online;
    const inGame = isHost ? activePeople.filter(person => person.status === 'game').length : widgetState.inGame;
    const serverName = (settings.mode === 'client' && widgetState.serverName) || settings.serverName || 'RadminCraft';
    const justOnline = Math.max(0, online - inGame);
    // Tooltip replaces the removed floating widget: in-game vs merely online.
    tray.setToolTip(`${serverName}\nВ игре: ${inGame}\nПросто в сети: ${justOnline}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: isHost ? '● Host запущен' : '● RadminCraft работает', enabled: false },
      { label: `В игре: ${inGame}`, enabled: false },
      { label: `Просто в сети: ${justOnline}`, enabled: false },
      { type: 'separator' },
      { label: 'Открыть RadminCraft', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: 'Выйти из RadminCraft', click: requestQuit }
    ]));
  });
}

app.whenReady().then(async () => {
  diagnosticLog('app.ready', { diagnosticsDir, incidentLogPath });
  app.setAppUserModelId('RadminCraft.Desktop');
  Menu.setApplicationMenu(null);
  ipcMain.handle('settings:load', readSettings);
  ipcMain.on('diagnostics:renderer-event', (_, details) => diagnosticLog('renderer.event', { details }));
  ipcMain.handle('diagnostics:path', () => incidentLogPath);
  ipcMain.handle('diagnostics:network', runNetworkDiagnostics);
  ipcMain.handle('diagnostics:open-folder', async () => { await shell.openPath(diagnosticsDir); return diagnosticsDir; });
  ipcMain.on('widget:open', () => { mainWindow?.show(); mainWindow?.focus(); });
  // Kept for compatibility with existing renderer calls; the floating widget is
  // gone and these numbers now only drive the tray tooltip.
  ipcMain.on('widget:state', (_, state) => { widgetState = { online: Math.max(0, Number(state?.online) || 0), inGame: Math.max(0, Number(state?.inGame) || 0), serverName: String(state?.serverName || '').slice(0, 48) }; updateTray(true); });
  ipcMain.handle('notify:show', (_, payload) => showDesktopNotification(payload));
  ipcMain.handle('window:focused', () => Boolean(mainWindow?.isFocused() && mainWindow?.isVisible()));
  // The overlay reports the height of its toast stack; the window is resized to
  // match and shown without focus so it never interrupts what the user is doing.
  ipcMain.on('toast:layout', (_, height) => {
    if (!toastWindow || toastWindow.isDestroyed()) return;
    const next = Math.max(1, Math.min(600, Number(height) || 0));
    toastWindow.setBounds(toastAnchor(next));
    if (!toastWindow.isVisible()) toastWindow.showInactive();
  });
  ipcMain.on('toast:empty', () => {
    if (toastWindow && !toastWindow.isDestroyed() && toastWindow.isVisible()) toastWindow.hide();
  });
  ipcMain.on('toast:open', (_, page) => {
    mainWindow?.show();
    mainWindow?.focus();
    if (page) mainWindow?.webContents.send('navigate:page', String(page));
  });
  ipcMain.handle('settings:save', async (_, partial) => {
    const previousSettings = await readSettings();
    let patch = { ...partial };
    if (partial.mode && partial.mode !== previousSettings.mode) {
      if (partial.mode === 'host') {
        const identity = await readIdentity();
        patch = {
          ...patch,
          communityId: crypto.randomUUID(),
          primaryHostDeviceId: identity.deviceId,
          primaryHostAddress: '',
          communityTerm: 1,
          temporaryHostPrepared: false,
          temporaryHostPreparationAttempted: false
        };
      } else {
        patch = {
          ...patch,
          communityId: '',
          primaryHostDeviceId: '',
          primaryHostAddress: '',
          communityTerm: 1,
          temporaryHostPrepared: false,
          temporaryHostPreparationAttempted: false
        };
      }
    }
    const settings = await writeSettings(patch);
    if ('launchAtStartup' in partial) app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtStartup), path: process.execPath });
    updateTray(true);
    if (partial.mode && (partial.mode !== 'host' || hostRuntime.role === 'temporary')) stopHost();
    if (settings.mode === 'host') {
      const identity = await readIdentity();
      const previous = hostPresence.get(identity.deviceId) || {};
      hostPresence.set(identity.deviceId, { ...previous, id: identity.deviceId, name: settings.displayName, avatar: settings.avatar, avatarImage: '', mcNickname: settings.mcNickname || '', status: isNicknameInGame(settings.mcNickname) ? 'game' : (previous.status === 'launcher' ? 'launcher' : 'network'), role: 'host', voiceJoined: Boolean(previous.voiceJoined), seenAt: Date.now() });
      startHost().catch(() => {});
      // Restart the bridge when its configuration changed, since startHost()
      // early-returns once the server is already listening.
      if (['serverPath', 'mapPort', 'mapUrl', 'mcNickname'].some(key => key in partial) && hostServer?.listening) {
        startServerBridge().catch(() => {});
      }
    }
    return settings;
  });
  ipcMain.handle('launcher:open', async (_, launcherPath) => {
    if (!launcherPath) return { ok: false, reason: 'not-configured' };
    try {
      const child = spawn(launcherPath, [], { detached: true, stdio: 'ignore', windowsHide: false });
      launcherState = { active: true, path: launcherPath, processId: child.pid || 0, startedAt: Date.now() };
      launcherDetection = { checkedAt: Date.now(), active: true, lastSeenAt: Date.now(), misses: 0 };
      child.once('exit', () => { if (launcherState.processId === child.pid) launcherState.processId = 0; launcherDetection.checkedAt = 0; });
      child.once('error', () => { launcherState = { active: false, path: launcherPath, processId: 0, startedAt: 0 }; launcherDetection = { checkedAt: 0, active: false, lastSeenAt: 0, misses: 0 }; });
      child.unref(); return { ok: true };
    } catch (error) { return { ok: false, reason: error.message || 'launch-failed' }; }
  });
  ipcMain.handle('launcher:status', getLauncherState);
  ipcMain.handle('launcher:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите Minecraft-лаунчер', properties: ['openFile'], filters: [{ name: 'Приложения Windows', extensions: ['exe'] }] });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('server:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите папку сервера Minecraft', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { ok: false };
    const folder = result.filePaths[0];
    // Confirm this really looks like a server folder so the wizard can reassure
    // the user instead of silently accepting a wrong pick.
    const hasLog = fsSync.existsSync(path.join(folder, 'logs', 'latest.log'));
    return { ok: true, path: folder, hasLog };
  });
  ipcMain.handle('bridge:diagnose', async () => {
    const settings = await readSettings();
    const logPath = resolveLogPath(settings.serverPath);
    const logFound = logPath ? fsSync.existsSync(logPath) : false;
    let bluemapOk = false;
    try { const response = await fetch(`${bluemapBase(settings)}settings.json`, { signal: AbortSignal.timeout(2500) }); bluemapOk = response.ok; } catch {}
    return { logConfigured: Boolean(logPath), logFound, bluemapOk, players: serverPlayers.size };
  });
  ipcMain.handle('avatar:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите аватар', properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled) return '';
    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).slice(1).replace('jpg', 'jpeg');
    return `data:image/${extension};base64,${(await fs.readFile(filePath)).toString('base64')}`;
  });
  ipcMain.handle('messages:load', readMessages);
  ipcMain.handle('messages:save', (_, messages) => writeMessages(messages));
  ipcMain.handle('lan:status', lanStatus);
  ipcMain.handle('lan:address', lanAddress);
  ipcMain.handle('radmin:status', radminVpnStatus);
  ipcMain.handle('lan:messages', lanMessages);
  ipcMain.handle('lan:send-message', (_, message) => lanSendMessage(message));
  ipcMain.handle('lan:update-message-profile', (_, profile) => lanUpdateMessageProfile(profile));
  ipcMain.handle('lan:delete-message', (_, id) => lanDeleteMessage(id));
  ipcMain.handle('lan:clear-messages', lanClearMessages);
  ipcMain.handle('lan:presence', (_, person) => lanPresence(person));
  ipcMain.handle('lan:check-display-name', (_, candidate) => lanCheckDisplayName(candidate));
  ipcMain.handle('lan:people', lanPeople);
  ipcMain.handle('minecraft-link:request', minecraftLinkRequest);
  ipcMain.handle('minecraft-link:status', (_, code) => minecraftLinkStatus(code));
  ipcMain.handle('minecraft-link:cancel', (_, code) => minecraftLinkCancel(code));
  ipcMain.handle('lan:members', async () => {
    const status = await lanStatus();
    if (!status.ok) return { ok: false, members: [] };
    if (status.mode === 'host') return { ok: true, members: [...hostMembers.values()] };
    try {
      const response = await fetchWithTimeout(`${hostUrl(status.address)}/api/members`);
      const body = await response.json();
      const members = Array.isArray(body.members) ? body.members : [];
      if (response.ok) await cacheCommunityMembers(members);
      return { ok: response.ok, members };
    } catch { return { ok: false, members: [] }; }
  });
  ipcMain.handle('firewall:ensure', ensureWindowsFirewallAccess);
  ipcMain.handle('bridge:status', lanBridgeStatus);
  ipcMain.handle('bridge:install-mod', installForgeBridge);
  ipcMain.handle('map:info', lanMapInfo);
  ipcMain.handle('map:open', async (_, url) => { if (!/^https?:\/\//i.test(String(url || ''))) return false; await shell.openExternal(url); return true; });
  ipcMain.handle('mods:open', async (_, url) => { if (!/^https?:\/\//i.test(String(url || ''))) return false; await shell.openExternal(url); return true; });
  ipcMain.handle('voice:signal', (_, signal) => lanVoiceSignal(signal));
  ipcMain.handle('voice:signals', (_, deviceId) => lanVoiceSignals(deviceId));
  ipcMain.handle('voice:invite', (_, invite) => lanVoiceInvite(invite));
  ipcMain.handle('voice:invites', (_, deviceId) => lanVoiceInvites(deviceId));
  ipcMain.handle('identity:public', async () => {
    const identity = await readIdentity();
    return { deviceId: identity.deviceId, publicKey: identity.publicKey, createdAt: identity.createdAt };
  });
  await readIdentity();
  const initialSettings = await readSettings();
  app.setLoginItemSettings({ openAtLogin: Boolean(initialSettings.launchAtStartup), path: process.execPath });
  updateTray(true);
  if (initialSettings.mode === 'host' && initialSettings.onboardingCompleted) {
    const vpn = await radminVpnStatus();
    if (vpn.detected) ensureWindowsFirewallAccess().catch(() => {});
  }
  createWindow();
  setupAutoUpdater({
    app,
    ipcMain,
    getWindow: () => mainWindow,
    readSettings,
    writeSettings,
    log: diagnosticLog
  });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  stopHost();
  // The overlay is a hidden BrowserWindow; leaving it alive would keep
  // 'window-all-closed' from ever firing.
  if (toastWindow && !toastWindow.isDestroyed()) { toastWindow.destroy(); toastWindow = undefined; }
});
