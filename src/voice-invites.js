(() => {
  const controls = document.querySelector('.voice-controls'); if (!controls || !window.radmincraft?.sendVoiceInvite) return;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'voice-icon-button voice-invite-button'; button.title = 'Пригласить в голосовой чат'; button.setAttribute('aria-label', button.title); button.innerHTML = '<img src="icons/user-plus.svg" alt="">';
  controls.insertBefore(button, controls.querySelector('.voice-channel-button'));
  let identity; let pollRunning = false;
  const closeModal = modal => modal?.remove();
  const openPicker = async () => {
    identity ||= await window.radmincraft.getPublicIdentity(); const settings = await window.radmincraft.loadSettings();
    const available = people.map(person => ({ name: person[1], avatar: person[0], voiceJoined: person[6], id: person[7] })).filter(person => person.id && person.id !== identity.deviceId);
    const backdrop = document.createElement('div'); backdrop.className = 'invite-backdrop';
    const dialog = document.createElement('section'); dialog.className = 'invite-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'invite-title');
    dialog.innerHTML = '<div class="invite-heading"><div><h2 id="invite-title">Пригласить в голосовой чат</h2><p>Можно выбрать сразу нескольких участников.</p></div><button type="button" data-close aria-label="Закрыть">×</button></div><div class="invite-people"></div><div class="invite-actions"><span class="invite-feedback" role="status"></span><button type="button" data-send disabled>Отправить приглашение</button></div>';
    const list = dialog.querySelector('.invite-people'); const send = dialog.querySelector('[data-send]'); const feedback = dialog.querySelector('.invite-feedback');
    if (!available.length) list.innerHTML = '<p class="muted">Сейчас в сети нет других участников.</p>';
    available.forEach(person => { const label = document.createElement('label'); label.className = 'invite-person'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = person.id; const avatar = document.createElement('b'); avatar.className = 'avatar'; window.RadminCraftAvatars?.paint(avatar, person.avatar); const copy = document.createElement('span'); copy.innerHTML = `<strong></strong><small>${person.voiceJoined ? 'уже в голосовом канале' : 'в сети'}</small>`; copy.querySelector('strong').textContent = person.name; label.append(checkbox, avatar, copy); list.append(label); });
    list.addEventListener('change', () => { send.disabled = !list.querySelector('input:checked'); });
    send.addEventListener('click', async () => {
      send.disabled = true; const selected = [...list.querySelectorAll('input:checked')];
      const results = await Promise.all(selected.map(input => window.radmincraft.sendVoiceInvite({ from: identity.deviceId, to: input.value, name: settings.displayName })));
      const sent = results.filter(result => result.ok).length; feedback.textContent = sent ? `Отправлено: ${sent}` : 'Не удалось отправить приглашение';
      if (sent) setTimeout(() => closeModal(backdrop), 700); else send.disabled = false;
    });
    const close = () => { document.removeEventListener('keydown', onKey); closeModal(backdrop); }; const onKey = event => { if (event.key === 'Escape') close(); };
    dialog.querySelector('[data-close]').addEventListener('click', close); backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); }); document.addEventListener('keydown', onKey); backdrop.append(dialog); document.body.append(backdrop); dialog.querySelector('[data-close]').focus();
  };
  button.addEventListener('click', openPicker);

  const showInvite = invite => {
    window.radmincraftSounds?.voiceInvite();
    window.radmincraftNotify?.({
      kind: 'voice',
      title: `${invite.name} зовёт в голосовой`,
      body: 'Нажмите, чтобы присоединиться',
      page: 'voice',
      setting: 'notifyVoiceInvite'
    });
  };
  const poll = async () => {
    if (pollRunning) return; pollRunning = true;
    try { identity ||= await window.radmincraft.getPublicIdentity(); const result = await window.radmincraft.getVoiceInvites(identity.deviceId); if (result.ok && result.invites.length) showInvite(result.invites[result.invites.length - 1]); } catch {} finally { pollRunning = false; }
  };
  poll(); window.setInterval(poll, 3000);
})();
