(() => {
  const list = document.querySelector('#voice-list');
  const mic = document.querySelector('#mic');
  const row = mic?.closest('.row');
  if (!list || !mic || !row || !window.radmincraft?.getVoiceSignals) return;

  let memberAudio = {};
  let connected = false;
  let joining = false;
  let refreshingMembers = false;
  let micEnabled = true;
  let deafened = false;
  let localStream;
  let identity;
  let settings;
  let ownSpeaking = false;
  let lastPresenceSent = 0;
  let sessionId = '';
  let aloneSince = 0;
  // Id of whoever spoke most recently. Drives the compact voice widget on the
  // chat sidebar (Zoom-style active-speaker tile). Self takes priority while
  // you talk; otherwise it holds the last person who spoke.
  let activeSpeakerId = '';
  const peers = new Map();
  const members = new Map();
  const expandedAudio = new Set();
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  const controls = document.createElement('div'); controls.className = 'voice-controls';
  const deafen = document.createElement('button'); deafen.type = 'button'; deafen.className = 'voice-icon-button voice-deafen';
  const leave = document.createElement('button'); leave.type = 'button'; leave.className = 'voice-channel-button';
  const footer = document.createElement('div'); footer.className = 'voice-footer';
  const aloneTimer = document.createElement('div'); aloneTimer.className = 'voice-alone-timer'; aloneTimer.hidden = true;
  controls.append(mic, deafen, leave); footer.append(aloneTimer, controls); list.after(footer);
  mic.onclick = null; mic.className = 'voice-icon-button voice-mic';

  const badge = document.querySelector('#voice header em');
  const setMicButton = () => {
    mic.title = micEnabled ? 'Выключить микрофон' : 'Включить микрофон'; mic.setAttribute('aria-label', mic.title);
    mic.innerHTML = `<img src="icons/${micEnabled ? 'microphone.svg' : 'microphone-off.svg'}" alt=""><span>${micEnabled ? 'Микрофон' : 'Микрофон выключен'}</span>`; mic.classList.toggle('is-off', !micEnabled);
  };
  const setDeafenButton = () => {
    deafen.title = deafened ? 'Слышать всех' : 'Заглушить всех'; deafen.setAttribute('aria-label', deafen.title);
    deafen.innerHTML = `<img src="icons/${deafened ? 'speaker-off.svg' : 'speaker.svg'}" alt=""><span>${deafened ? 'Звук выключен' : 'Слышу всех'}</span>`; deafen.classList.toggle('is-off', deafened);
  };
  const setConnectionControls = () => {
    leave.textContent = joining ? 'Подключение…' : connected ? 'Выйти' : 'Войти в канал'; leave.classList.toggle('is-connected', connected); leave.disabled = joining;
    mic.disabled = !connected; deafen.disabled = !connected;
    if (badge) badge.textContent = connected ? 'Подключено' : 'Не подключено';
  };
  const updateAloneTimer = () => {
    const alone = connected && aloneSince > 0 && members.size <= 1;
    aloneTimer.hidden = !alone;
    if (!alone) return;
    const remaining = Math.max(0, 10 * 60 * 1000 - (Date.now() - aloneSince));
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.ceil((remaining % 60000) / 1000);
    aloneTimer.textContent = `Вы одни · отключение через ${minutes}:${String(seconds).padStart(2, '0')}`;
    aloneTimer.title = 'Если в канале никого больше нет, RadminCraft отключит вас через 10 минут и освободит микрофон.';
  };

  const stateFor = id => memberAudio[id] || { muted: false, volume: 100, previousVolume: 100 };
  const saveAudio = () => window.radmincraft.saveSettings({ voiceAudio: memberAudio });
  const setPeerVolume = id => {
    const peer = peers.get(id); const personal = stateFor(id).volume / 100; const global = Number(settings?.volume ?? 70) / 100;
    if (peer?.audio) peer.audio.volume = deafened ? 0 : Math.max(0, Math.min(1, personal * global));
  };
  const applyOutputDevice = async id => {
    for (const peer of peers.values()) if (peer.audio?.setSinkId) { try { await peer.audio.setSinkId(id || ''); } catch {} }
  };
  const monitorOwnSpeech = stream => {
    const context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser); const data = new Uint8Array(analyser.frequencyBinCount); let envelope = 0; let lastVoiceAt = 0;
    const tick = () => {
      if (!connected || !localStream || stream !== localStream) { context.close(); return; }
      analyser.getByteTimeDomainData(data); const level = data.reduce((sum, value) => sum + Math.abs(value - 128), 0) / data.length;
      envelope = Math.max(level, envelope * .88); if (micEnabled && envelope > 3.7) lastVoiceAt = performance.now();
      const speaking = micEnabled && performance.now() - lastVoiceAt < 780;
      if (ownSpeaking !== speaking) { ownSpeaking = speaking; const self = members.get(identity?.deviceId); if (self) self.speaking = speaking; sendPresence(); draw(); }
      requestAnimationFrame(tick);
    }; tick();
  };
  const switchInputDevice = async id => {
    if (!connected) return;
    const nextStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const nextTrack = nextStream.getAudioTracks()[0]; nextTrack.enabled = micEnabled; const oldStream = localStream;
    try {
      await Promise.all([...peers.values()].flatMap(peer => peer.pc.getSenders().filter(sender => sender.track?.kind === 'audio').map(sender => sender.replaceTrack(nextTrack))));
      localStream = nextStream; oldStream?.getTracks().forEach(track => track.stop()); monitorOwnSpeech(localStream);
    } catch (error) { nextStream.getTracks().forEach(track => track.stop()); throw error; }
  };
  window.radmincraftVoiceSetInput = switchInputDevice;
  window.radmincraftVoiceSetOutput = applyOutputDevice;
  window.radmincraftVoiceGetState = () => ({ connected, micEnabled, deafened });

  const audioControls = member => {
    const audio = stateFor(member.id);
    return `<div class="voice-audio" data-audio="${escapeHtml(member.id)}"><button type="button" class="voice-audio-toggle" aria-expanded="${expandedAudio.has(member.id)}">Настройки</button><div class="voice-audio-details ${expandedAudio.has(member.id) ? 'is-open' : ''}"><button type="button" class="voice-mute ${audio.muted ? 'is-muted' : ''}">${audio.muted ? 'Заглушен' : 'Заглушить'}</button><label><span>Громкость</span><input type="range" min="0" max="100" value="${audio.volume}" aria-label="Громкость ${escapeHtml(member.name)}"><output>${audio.volume}%</output></label></div></div>`;
  };
  const bindAudioControls = () => list.querySelectorAll('[data-audio]').forEach(control => {
    const id = control.dataset.audio; const button = control.querySelector('.voice-mute'); const toggle = control.querySelector('.voice-audio-toggle'); const range = control.querySelector('input'); const output = control.querySelector('output');
    range.style.setProperty('--voice-volume', `${range.value}%`);
    toggle.addEventListener('click', () => { expandedAudio.has(id) ? expandedAudio.delete(id) : expandedAudio.add(id); draw(); });
    button.addEventListener('click', () => { const previous = stateFor(id); memberAudio[id] = previous.muted ? { ...previous, muted: false, volume: previous.previousVolume || 100 } : { ...previous, muted: true, previousVolume: previous.volume || 100, volume: 0 }; saveAudio(); setPeerVolume(id); draw(); });
    range.addEventListener('input', () => { const volume = Number(range.value); output.textContent = `${volume}%`; range.style.setProperty('--voice-volume', `${volume}%`); memberAudio[id] = { ...stateFor(id), muted: volume === 0, volume, previousVolume: volume || stateFor(id).previousVolume || 100 }; setPeerVolume(id); });
    range.addEventListener('change', () => { saveAudio(); draw(); });
  });
  const voiceState = member => {
    if (member.voiceDeafened) return { key: 'deafened', label: 'никого не слышит' };
    if (member.micEnabled === false) return { key: 'mic-off', label: 'микрофон выключен' };
    return member.speaking ? { key: 'speaking', label: 'говорит' } : { key: 'silent', label: 'молчит' };
  };
  function draw() {
    list.className = 'voice-list tiles';
    const current = [...members.values()];
    if (!current.length) { list.innerHTML = `<div class="voice-empty"><strong>В голосовом канале пока никого нет.</strong>${connected ? '' : '<span>Можно войти первым.</span>'}</div>`; return; }
    list.innerHTML = current.map(member => {
      const state = voiceState(member); const self = member.id === identity?.deviceId;
      const avatar = `<span class="voice-avatar ${state.key === 'deafened' ? 'is-deafened' : ''}" data-member-id="${escapeHtml(member.id)}"></span>`;
      const role = member.role === 'host'
        ? '<em class="voice-host-badge">Host</em>'
        : member.role === 'temporary-host' ? '<em class="voice-host-badge">Временный Host</em>' : '';
      const meter = `<span class="voice-meter" aria-hidden="true">${Array.from({ length: 8 }, (_, index) => `<i style="--bar:${index}"></i>`).join('')}</span>`;
      const status = connected ? `<span class="voice-status ${state.key}">● ${state.label}</span>${meter}${self ? '' : audioControls(member)}` : '';
      const visibleName = window.radmincraftVisibleName?.(member.id, member.name) || member.name;
      const content = `${avatar}<span class="voice-name"><strong>${escapeHtml(visibleName)}</strong>${role}</span>${status}`;
      return `<article class="voice-tile ${state.key}">${content}</article>`;
    }).join(''); list.querySelectorAll('.voice-avatar[data-member-id]').forEach(element => { const member = members.get(element.dataset.memberId); window.RadminCraftAvatars?.paint(element, member?.avatar); }); bindAudioControls();
    updateAloneTimer();
    updateActiveSpeaker();
  }

  // Track the current/most-recent speaker and notify the mini widget.
  function updateActiveSpeaker() {
    const speaking = [...members.values()].filter(member => member.speaking);
    const self = speaking.find(member => member.id === identity?.deviceId);
    if (self) activeSpeakerId = self.id;
    else if (speaking.length) activeSpeakerId = speaking[0].id;
    else if (!members.has(activeSpeakerId)) activeSpeakerId = members.has(identity?.deviceId) ? identity.deviceId : (members.keys().next().value || '');
    window.dispatchEvent(new CustomEvent('radmincraft:voice-changed'));
  }

  // API for the compact sidebar widget (src/voice-mini.js).
  window.radmincraftVoice = {
    getState() {
      const speaker = members.get(activeSpeakerId) || members.get(identity?.deviceId);
      return {
        connected,
        micEnabled,
        deafened,
        count: members.size,
        speaker: speaker ? {
          id: speaker.id,
          name: window.radmincraftVisibleName?.(speaker.id, speaker.name) || speaker.name,
          avatar: speaker.avatar,
          speaking: Boolean(speaker.speaking),
          isSelf: speaker.id === identity?.deviceId
        } : null
      };
    },
    toggleMic: () => mic.click(),
    toggleDeafen: () => deafen.click(),
    leave: () => { if (connected && !joining) leaveChannel(); }
  };

  const sendPresence = async (force = false) => {
    if (!identity || !settings) return; if (!force && Date.now() - lastPresenceSent < 900) return; lastPresenceSent = Date.now();
    window.__radmincraftVoiceJoined = connected; window.__radmincraftVoiceSpeaking = ownSpeaking; window.__radmincraftVoiceDeafened = deafened; window.__radmincraftMicEnabled = micEnabled;
    const launcher = await window.radmincraft.getLauncherStatus?.();
    await window.radmincraft.sendLanPresence({ id: identity.deviceId, name: settings.displayName, avatar: settings.avatar, avatarImage: settings.avatarImage || '', mcNickname: settings.mcNickname || '', status: launcher?.active ? 'launcher' : 'network', role: settings.mode, voiceJoined: connected, voiceSpeaking: ownSpeaking, voiceDeafened: deafened, micEnabled });
  };
  const sendSignal = (to, payload) => window.radmincraft.sendVoiceSignal({ from: identity.deviceId, to, payload: { ...payload, sessionId } });
  const removePeer = id => { const peer = peers.get(id); if (!peer) return; clearTimeout(peer.disconnectTimer); peer.pc.close(); peer.audio?.remove(); peers.delete(id); };
  const speakingMeter = (id, stream) => {
    const context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 512; context.createMediaStreamSource(stream).connect(analyser); const data = new Uint8Array(analyser.frequencyBinCount); let envelope = 0; let lastVoiceAt = 0;
    const tick = () => { if (!peers.has(id)) { context.close(); return; } analyser.getByteTimeDomainData(data); const level = data.reduce((sum, value) => sum + Math.abs(value - 128), 0) / data.length; envelope = Math.max(level, envelope * .88); if (envelope > 3.7) lastVoiceAt = performance.now(); const speaking = performance.now() - lastVoiceAt < 780; const member = members.get(id); if (member && member.speaking !== speaking) { member.speaking = speaking; draw(); } requestAnimationFrame(tick); }; tick();
  };
  const createPeer = async (member, initiator, remoteSession = '') => {
    if (peers.has(member.id) || !localStream) return peers.get(member.id);
    const pc = new RTCPeerConnection({ iceServers: [] }); const peer = { pc, pendingCandidates: [], remoteSession }; peers.set(member.id, peer);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.onicecandidate = event => { if (event.candidate) sendSignal(member.id, { type: 'candidate', candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => { const stream = event.streams[0]; if (peer.audio) return; const audio = document.createElement('audio'); audio.autoplay = true; audio.srcObject = stream; audio.hidden = true; document.body.append(audio); peer.audio = audio; setPeerVolume(member.id); applyOutputDevice(settings?.voiceDevices?.outputId || ''); speakingMeter(member.id, stream); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) removePeer(member.id); else if (pc.connectionState === 'disconnected') peer.disconnectTimer = setTimeout(() => { if (pc.connectionState === 'disconnected') removePeer(member.id); }, 5000); else if (pc.connectionState === 'connected') clearTimeout(peer.disconnectTimer); };
    if (initiator) { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await sendSignal(member.id, { type: 'description', description: pc.localDescription.toJSON() }); }
    return peer;
  };
  const processSignals = async () => {
    if (!connected || !identity) return; const incoming = await window.radmincraft.getVoiceSignals(identity.deviceId); if (!incoming.ok) return;
    for (const signal of incoming.signals) {
      try {
        const member = members.get(signal.from); if (!member) continue; const payload = signal.payload || {}; let peer = peers.get(signal.from);
        if (payload.type === 'description' && payload.description?.type === 'offer' && peer?.remoteSession && payload.sessionId && peer.remoteSession !== payload.sessionId) { removePeer(signal.from); peer = undefined; }
        if (payload.type === 'candidate' && peer?.remoteSession && payload.sessionId && peer.remoteSession !== payload.sessionId) continue;
        if (!peer) peer = await createPeer(member, false, payload.sessionId || '');
        if (!peer.remoteSession && payload.sessionId) peer.remoteSession = payload.sessionId;
        if (payload.type === 'description') {
          await peer.pc.setRemoteDescription(payload.description);
          for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
          if (payload.description.type === 'offer') { const answer = await peer.pc.createAnswer(); await peer.pc.setLocalDescription(answer); await sendSignal(signal.from, { type: 'description', description: peer.pc.localDescription.toJSON() }); }
        } else if (payload.type === 'candidate') {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(payload.candidate); else peer.pendingCandidates.push(payload.candidate);
        }
      } catch { removePeer(signal.from); }
    }
  };
  const refreshMembers = async () => {
    if (!identity || refreshingMembers) return; refreshingMembers = true;
    try {
    const live = await window.radmincraft.getLanPeople(); if (!live.ok) { members.clear(); draw(); return; }
    const next = live.people.filter(person => person.voiceJoined).map(person => ({ ...person, speaking: person.id === identity.deviceId ? ownSpeaking : Boolean(person.voiceSpeaking) }));
    members.clear(); next.forEach(person => members.set(person.id, person));
    if (connected && next.length <= 1) {
      aloneSince ||= Date.now();
      if (Date.now() - aloneSince >= 10 * 60 * 1000) {
        await leaveChannel();
        window.radmincraftNotify?.({ kind: 'voice', title: 'Вы отключены от голосового чата', body: 'Вы находились в канале одни больше 10 минут.', page: 'voice', setting: 'notifyVoiceInvite' });
        window.radmincraftToast?.('Голосовой чат отключён: вы были одни больше 10 минут');
        return;
      }
    } else aloneSince = 0;
    if (connected) { for (const person of next) if (person.id !== identity.deviceId && identity.deviceId < person.id) await createPeer(person, true); for (const id of [...peers.keys()]) if (!members.has(id)) removePeer(id); await processSignals(); }
    draw();
    } finally { refreshingMembers = false; }
  };
  const join = async () => {
    if (joining || connected) return; joining = true; setConnectionControls();
    try {
      settings = await window.radmincraft.loadSettings(); identity = await window.radmincraft.getPublicIdentity(); await window.radmincraft.getVoiceSignals(identity.deviceId); sessionId = crypto.randomUUID();
      localStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: settings.voiceDevices?.inputId ? { exact: settings.voiceDevices.inputId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      localStream.getAudioTracks().forEach(track => { track.enabled = micEnabled; }); connected = true; setMicButton(); setDeafenButton(); setConnectionControls(); await sendPresence(true); await refreshMembers(); monitorOwnSpeech(localStream); window.radmincraftSounds?.joinedVoice();
    } catch { connected = false; window.__radmincraftVoiceJoined = false; peers.forEach((_, id) => removePeer(id)); localStream?.getTracks().forEach(track => track.stop()); localStream = undefined; list.innerHTML = '<p class="muted" role="alert">Не удалось открыть микрофон. Разрешите доступ к нему в Windows и попробуйте снова.</p>'; }
    finally { joining = false; setConnectionControls(); }
  };
  const leaveChannel = async () => {
    connected = false; aloneSince = 0; ownSpeaking = false; sessionId = ''; peers.forEach((_, id) => removePeer(id)); localStream?.getTracks().forEach(track => track.stop()); localStream = undefined;
    await sendPresence(true); if (identity) await window.radmincraft.getVoiceSignals(identity.deviceId); await refreshMembers(); window.radmincraftSounds?.leftVoice(); setConnectionControls(); draw();
  };

  mic.addEventListener('click', () => { micEnabled = !micEnabled; localStream?.getAudioTracks().forEach(track => { track.enabled = micEnabled; }); const self = members.get(identity?.deviceId); if (self) self.micEnabled = micEnabled; if (!micEnabled) { ownSpeaking = false; if (self) self.speaking = false; } sendPresence(true); setMicButton(); draw(); });
  deafen.addEventListener('click', () => { deafened = !deafened; for (const id of peers.keys()) setPeerVolume(id); const self = members.get(identity?.deviceId); if (self) self.voiceDeafened = deafened; sendPresence(true); setDeafenButton(); draw(); });
  leave.addEventListener('click', () => { if (!joining) connected ? leaveChannel() : join(); });
  window.addEventListener('radmincraft:audio-settings-changed', async () => { settings = await window.radmincraft.loadSettings(); for (const id of peers.keys()) setPeerVolume(id); await applyOutputDevice(settings.voiceDevices?.outputId || ''); });
  draw();
  Promise.all([window.radmincraft.loadSettings(), window.radmincraft.getPublicIdentity()]).then(([saved, publicIdentity]) => { settings = saved; identity = publicIdentity; memberAudio = saved.voiceAudio || {}; window.__radmincraftMicEnabled = micEnabled; window.__radmincraftVoiceDeafened = deafened; setMicButton(); setDeafenButton(); setConnectionControls(); refreshMembers(); window.setInterval(refreshMembers, 1500); window.setInterval(updateAloneTimer, 1000); });
})();
