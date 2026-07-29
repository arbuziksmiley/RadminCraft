(() => {
  let context;
  const messagePresets = {
    'message-1': [[659, .045, 'sine'], [784, .075, 'sine']],
    'message-2': [[523, .05, 'triangle'], [698, .065, 'triangle']],
    'message-3': [[880, .035, 'sine'], [988, .055, 'sine']],
    'message-4': [[392, .05, 'triangle'], [587, .075, 'sine']],
    'message-5': [[740, .04, 'sine'], [622, .04, 'sine'], [831, .065, 'sine']]
  };
  const invitePresets = {
    'invite-1': [[440, .12, 'sine'], [554, .12, 'sine'], [659, .22, 'sine']],
    'invite-2': [[523, .1, 'triangle'], [659, .1, 'triangle'], [784, .2, 'sine']],
    'invite-3': [[392, .11, 'sine'], [494, .11, 'sine'], [587, .11, 'sine'], [740, .19, 'sine']],
    'invite-4': [[659, .13, 'sine'], [587, .09, 'sine'], [784, .21, 'triangle']],
    'invite-5': [[466, .1, 'triangle'], [622, .15, 'sine'], [698, .1, 'sine'], [932, .2, 'sine']]
  };
  const getContext = () => { if (!context) context = new (window.AudioContext || window.webkitAudioContext)(); if (context.state === 'suspended') context.resume(); return context; };
  const tone = (notes, percent = 70, base = .03) => {
    const audio = getContext(); let offset = audio.currentTime; const volume = Math.max(.0001, base * Math.max(0, Math.min(100, Number(percent))) / 100);
    notes.forEach(([frequency, duration, wave = 'sine']) => {
      const oscillator = audio.createOscillator(); const gain = audio.createGain(); oscillator.type = wave; oscillator.frequency.setValueAtTime(frequency, offset);
      gain.gain.setValueAtTime(.0001, offset); gain.gain.exponentialRampToValueAtTime(volume, offset + .012); gain.gain.exponentialRampToValueAtTime(.0001, offset + duration);
      oscillator.connect(gain).connect(audio.destination); oscillator.start(offset); oscillator.stop(offset + duration + .02); offset += duration + .025;
    });
  };
  const configured = async (group, force = false) => {
    const settings = await window.radmincraft?.loadSettings?.(); if (!force && settings?.notificationsEnabled === false) return;
    if (group === 'incoming') tone(messagePresets[settings?.incomingMessageSound] || messagePresets['message-3'], settings?.incomingMessageVolume ?? 100, .03);
    if (group === 'outgoing') tone(messagePresets[settings?.outgoingMessageSound] || messagePresets['message-4'], settings?.outgoingMessageVolume ?? 100, .025);
    if (group === 'invite') tone(invitePresets[settings?.voiceInviteSound] || invitePresets['invite-4'], settings?.voiceInviteVolume ?? 100, .032);
  };
  const gameJoined = async () => {
    const settings = await window.radmincraft?.loadSettings?.();
    if (settings?.notificationsEnabled === false) return;
    tone([[392, .055, 'triangle'], [523, .075, 'triangle'], [659, .11, 'sine']], 58, .025);
  };
  window.radmincraftSounds = {
    message: () => configured('incoming'),
    messageIncoming: () => configured('incoming'),
    messageOutgoing: () => configured('outgoing'),
    voiceInvite: () => configured('invite'),
    gameJoined,
    preview: (group, sound, volume) => tone(group === 'invite' ? (invitePresets[sound] || invitePresets['invite-1']) : (messagePresets[sound] || messagePresets['message-1']), volume, group === 'invite' ? .032 : .03),
    joinedVoice: () => tone([[523, .05], [659, .08]], 70, .028),
    leftVoice: () => tone([[440, .07]], 55, .022),
    success: () => tone([[523, .04], [659, .04], [784, .08]], 70, .026)
  };
  document.addEventListener('pointerdown', () => { try { getContext(); } catch {} }, { once: true });
})();
