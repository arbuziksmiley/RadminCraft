const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('error', event => ipcRenderer.send('diagnostics:renderer-event', {
  type: 'error', message: event.message || '', source: event.filename || '', line: event.lineno || 0, column: event.colno || 0,
  stack: event.error?.stack || ''
}));
window.addEventListener('unhandledrejection', event => ipcRenderer.send('diagnostics:renderer-event', {
  type: 'unhandledrejection', message: event.reason?.message || String(event.reason || ''), stack: event.reason?.stack || ''
}));

contextBridge.exposeInMainWorld('radmincraft', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: partial => ipcRenderer.invoke('settings:save', partial),
  openLauncher: launcherPath => ipcRenderer.invoke('launcher:open', launcherPath),
  getLauncherStatus: () => ipcRenderer.invoke('launcher:status'),
  chooseLauncher: () => ipcRenderer.invoke('launcher:choose'),
  chooseAvatar: () => ipcRenderer.invoke('avatar:choose'),
  loadMessages: () => ipcRenderer.invoke('messages:load'),
  saveMessages: messages => ipcRenderer.invoke('messages:save', messages),
  getLanStatus: () => ipcRenderer.invoke('lan:status'),
  getLanAddress: () => ipcRenderer.invoke('lan:address'),
  getRadminVpnStatus: () => ipcRenderer.invoke('radmin:status'),
  getLanMessages: () => ipcRenderer.invoke('lan:messages'),
  sendLanMessage: message => ipcRenderer.invoke('lan:send-message', message),
  updateMessageProfile: profile => ipcRenderer.invoke('lan:update-message-profile', profile),
  deleteLanMessage: id => ipcRenderer.invoke('lan:delete-message', id),
  clearLanMessages: () => ipcRenderer.invoke('lan:clear-messages'),
  sendLanPresence: person => ipcRenderer.invoke('lan:presence', person),
  checkDisplayName: candidate => ipcRenderer.invoke('lan:check-display-name', candidate),
  getLanPeople: () => ipcRenderer.invoke('lan:people'),
  getLanMembers: () => ipcRenderer.invoke('lan:members'),
  requestMinecraftLink: () => ipcRenderer.invoke('minecraft-link:request'),
  getMinecraftLinkStatus: code => ipcRenderer.invoke('minecraft-link:status', code),
  cancelMinecraftLink: code => ipcRenderer.invoke('minecraft-link:cancel', code),
  ensureFirewallAccess: () => ipcRenderer.invoke('firewall:ensure'),
  chooseServerFolder: () => ipcRenderer.invoke('server:choose-folder'),
  diagnoseBridge: () => ipcRenderer.invoke('bridge:diagnose'),
  getBridgeStatus: () => ipcRenderer.invoke('bridge:status'),
  installBridgeMod: () => ipcRenderer.invoke('bridge:install-mod'),
  getMapInfo: () => ipcRenderer.invoke('map:info'),
  openMapExternal: url => ipcRenderer.invoke('map:open', url),
  openMods: url => ipcRenderer.invoke('mods:open', url),
  openWidget: () => ipcRenderer.send('widget:open'),
  setWidgetState: state => ipcRenderer.send('widget:state', state),
  showNotification: payload => ipcRenderer.invoke('notify:show', payload),
  isWindowFocused: () => ipcRenderer.invoke('window:focused'),
  onNavigatePage: callback => ipcRenderer.on('navigate:page', (_, page) => callback(page)),
  sendVoiceSignal: signal => ipcRenderer.invoke('voice:signal', signal),
  getVoiceSignals: deviceId => ipcRenderer.invoke('voice:signals', deviceId),
  sendVoiceInvite: invite => ipcRenderer.invoke('voice:invite', invite),
  getVoiceInvites: deviceId => ipcRenderer.invoke('voice:invites', deviceId),
  getPublicIdentity: () => ipcRenderer.invoke('identity:public'),
  getDiagnosticsPath: () => ipcRenderer.invoke('diagnostics:path'),
  runNetworkDiagnostics: () => ipcRenderer.invoke('diagnostics:network'),
  openDiagnosticsFolder: () => ipcRenderer.invoke('diagnostics:open-folder'),
  getUpdateState: () => ipcRenderer.invoke('updates:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  deferUpdate: () => ipcRenderer.invoke('updates:defer'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('updates:state', listener);
    return () => ipcRenderer.removeListener('updates:state', listener);
  }
});
