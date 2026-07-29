// Compact active-call widget on the chat sidebar.
//
// Appears only while you are in the voice channel. Shows the current (or most
// recent) speaker Zoom-style — the tile switches to your own avatar the moment
// you talk — plus quick controls: open the voice tab, toggle deafen, toggle
// mic, leave the call. All state and actions come from window.radmincraftVoice
// (voice-view.js); this module only renders.
(() => {
  const stack = document.querySelector('#chat .stack');
  if (!stack || !window.radmincraft) return;

  const icons = {
    open: '<path d="M3 12h3l2-5 4 10 3-7 2 2h4"/><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
    micOff: '<path d="m2 2 20 20"/><path d="M9 9v2a3 3 0 0 0 5 2"/><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M19 10v1a7 7 0 0 1-.9 3.4M15.5 18.7A7 7 0 0 1 5 12v-1"/>',
    deaf: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2v-2ZM20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2v-2Z"/>',
    deafOff: '<path d="m2 2 20 20"/><path d="M4 14v-3a8 8 0 0 1 12.9-6.3M20 14v-3M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2v-2ZM20 14a2 2 0 0 0-2-2h-1v4"/>',
    leave: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17 5 12l5-5M5 12h11"/>'
  };
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  const card = document.createElement('article');
  card.className = 'card voice-mini';
  card.hidden = true;
  card.innerHTML = `
    <div class="vm-head">
      <span class="vm-avatar" data-vm-avatar></span>
      <span class="vm-copy">
        <strong data-vm-name>—</strong>
        <small data-vm-status>В голосовом канале</small>
      </span>
    </div>
    <div class="vm-controls">
      <button type="button" class="vm-btn" data-vm-open title="Открыть голосовой чат" aria-label="Открыть голосовой чат">${svg(icons.open)}</button>
      <button type="button" class="vm-btn" data-vm-mic title="Микрофон" aria-label="Микрофон">${svg(icons.mic)}</button>
      <button type="button" class="vm-btn" data-vm-deaf title="Звук" aria-label="Не слышать всех">${svg(icons.deaf)}</button>
      <button type="button" class="vm-btn vm-leave" data-vm-leave title="Выйти из голосового" aria-label="Выйти из голосового">${svg(icons.leave)}</button>
    </div>`;
  stack.append(card);

  const avatar = card.querySelector('[data-vm-avatar]');
  const name = card.querySelector('[data-vm-name]');
  const status = card.querySelector('[data-vm-status]');
  const micBtn = card.querySelector('[data-vm-mic]');
  const deafBtn = card.querySelector('[data-vm-deaf]');

  card.querySelector('[data-vm-open]').addEventListener('click', () => document.querySelector('.nav[data-page="voice"]')?.click());
  micBtn.addEventListener('click', () => { window.radmincraftVoice?.toggleMic(); requestAnimationFrame(render); });
  deafBtn.addEventListener('click', () => { window.radmincraftVoice?.toggleDeafen(); requestAnimationFrame(render); });
  card.querySelector('[data-vm-leave]').addEventListener('click', () => window.radmincraftVoice?.leave());

  let lastAvatarId = '';
  const render = () => {
    const state = window.radmincraftVoice?.getState();
    if (!state || !state.connected) { card.hidden = true; return; }
    card.hidden = false;

    const speaker = state.speaker;
    if (speaker) {
      if (lastAvatarId !== speaker.avatar + speaker.id) {
        window.RadminCraftAvatars?.paint(avatar, speaker.avatar);
        lastAvatarId = speaker.avatar + speaker.id;
      }
      name.textContent = speaker.isSelf ? 'Вы' : speaker.name;
      status.textContent = speaker.speaking ? 'говорит' : 'молчит';
      avatar.classList.toggle('is-speaking', speaker.speaking);
      status.classList.toggle('is-speaking', speaker.speaking);
    } else {
      name.textContent = `В канале: ${state.count}`;
      status.textContent = 'тишина';
      avatar.classList.remove('is-speaking');
      status.classList.remove('is-speaking');
    }

    micBtn.classList.toggle('is-off', !state.micEnabled);
    micBtn.innerHTML = svg(state.micEnabled ? icons.mic : icons.micOff);
    deafBtn.classList.toggle('is-off', state.deafened);
    deafBtn.innerHTML = svg(state.deafened ? icons.deafOff : icons.deaf);
  };

  window.addEventListener('radmincraft:voice-changed', render);
  // Fallback poll in case an event is missed; cheap because render is a no-op
  // when nothing changed materially.
  window.setInterval(render, 1500);
  render();
})();
