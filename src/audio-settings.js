(() => {
  const panel = document.querySelector('#settings .settings'); const page = document.querySelector('#settings');
  if (!panel || !page) return;
  // Settings are split into four tabs. Other modules must not guess where their
  // rows belong: they read window.radmincraftSettings, exposed at the bottom of
  // this block. Inserting relative to #save-settings used to throw, because the
  // save button lives inside .settings-actions rather than in the panel itself.
  const tabs = document.createElement('div'); tabs.className = 'settings-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Разделы настроек');
  const paneNames = [['general', 'Общие'], ['notifications', 'Уведомления'], ['sound', 'Звук'], ['connection', 'Подключение'], ['host', 'Host']];
  const panes = {};
  const buttons = {};
  paneNames.forEach(([key, label]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.dataset.tab = key; button.setAttribute('role', 'tab');
    tabs.append(button); buttons[key] = button;
    if (key === 'host') button.hidden = true;
    const pane = document.createElement('div');
    pane.className = `settings-pane settings-${key}`;
    pane.hidden = key !== 'general';
    panes[key] = pane;
  });
  page.insertBefore(tabs, panel);
  const general = panes.general;
  const sound = panes.sound;
  general.append(...panel.children);
  panel.append(...Object.values(panes));

  const activate = name => {
    if (name === 'host' && buttons.host.hidden) name = 'general';
    Object.entries(panes).forEach(([key, pane]) => { pane.hidden = key !== name; });
    Object.entries(buttons).forEach(([key, button]) => {
      button.classList.toggle('is-active', key === name);
      button.setAttribute('aria-selected', String(key === name));
    });
    const footer = page.querySelector('.settings-author');
    if (footer) footer.hidden = name !== 'general';
  };
  Object.entries(buttons).forEach(([key, button]) => button.addEventListener('click', () => activate(key)));
  activate('general');

  // The connection card belongs with the connection tab, not with general settings.
  const connectionInfo = general.querySelector('.connection-info');
  if (connectionInfo) panes.connection.append(connectionInfo);
  const connectionTools = general.querySelector('.settings-more');
  if (connectionTools) panes.connection.append(connectionTools);

  general.querySelectorAll('.host-only-setting').forEach(item => panes.host.append(item));

  window.radmincraftSettings = { panes, activate };
  window.dispatchEvent(new CustomEvent('radmincraft:settings-ready', { detail: window.radmincraftSettings }));
  const author = document.createElement('footer');
  author.className = 'settings-author';
  author.innerHTML = '<span><strong>RadminCraft</strong><small>Автор проекта: Arbuzik Smiley</small></span><button type="button">Поддержать проект</button>';
  author.querySelector('button').addEventListener('click', () => window.radmincraft.openMods?.('https://boosty.to/arbuzik_smiley/donate'));
  page.append(author);

  const voiceVolumeRow = document.querySelector('#volume')?.closest('.setting-item-clean');
  const voiceVolume = document.querySelector('#volume');
  const voiceOutput = document.querySelector('#volume-out');
  const setRangeFill = range => range.style.setProperty('--range-value', `${range.value}%`);
  if (voiceVolumeRow && voiceVolume) {
    voiceVolumeRow.classList.add('sound-setting-row', 'voice-volume-row');
    const controls = voiceVolumeRow.querySelector('.range-clean');
    controls.className = 'sound-setting-controls voice-volume-controls'; controls.append(voiceVolume, voiceOutput);
    sound.append(voiceVolumeRow); setRangeFill(voiceVolume);
  }
  voiceVolume?.addEventListener('input', () => setRangeFill(voiceVolume));
  voiceVolume?.addEventListener('change', async () => { await window.radmincraft.saveSettings({ volume: Number(voiceVolume.value) }); window.dispatchEvent(new Event('radmincraft:audio-settings-changed')); window.radmincraftToast?.('Настройки применены'); });
  const messageNames = ['Мягкий звон', 'Короткая нота', 'Светлый щелчок', 'Низкий сигнал', 'Три ноты'];
  const inviteNames = ['Спокойный вызов', 'Восходящий звон', 'Четыре ноты', 'Ответный сигнал', 'Длинная мелодия'];
  let previewTimer;
  const makeSoundRow = ({ label, description, volumeKey, soundKey, group, names }) => {
    const row = document.createElement('div'); row.className = 'sound-setting-row';
    const copy = document.createElement('div'); copy.className = 'setting-copy'; copy.innerHTML = `<strong>${label}</strong><small>${description}</small>`;
    const controls = document.createElement('div'); controls.className = 'sound-setting-controls';
    const select = document.createElement('select'); select.setAttribute('aria-label', `Сигнал: ${label}`); names.forEach((name, index) => { const option = document.createElement('option'); option.value = `${group === 'invite' ? 'invite' : 'message'}-${index + 1}`; option.textContent = name; select.append(option); });
    const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.setAttribute('aria-label', `Громкость: ${label}`);
    const output = document.createElement('output'); const test = document.createElement('button'); test.type = 'button'; test.className = 'sound-test'; test.textContent = 'Проверить';
    const preview = () => window.radmincraftSounds?.preview(group, select.value, Number(range.value));
    const save = () => window.radmincraft.saveSettings({ [volumeKey]: Number(range.value), [soundKey]: select.value });
    range.addEventListener('input', () => { output.textContent = `${range.value}%`; setRangeFill(range); clearTimeout(previewTimer); previewTimer = setTimeout(preview, 180); });
    range.addEventListener('change', async () => { await save(); window.dispatchEvent(new Event('radmincraft:audio-settings-changed')); window.radmincraftToast?.('Настройки применены'); });
    select.addEventListener('change', async () => { await save(); preview(); window.radmincraftToast?.('Настройки применены'); }); test.addEventListener('click', preview);
    controls.append(select, range, output, test); row.append(copy, controls); sound.append(row); return { select, range, output, soundKey, volumeKey };
  };
  const soundRows = [
    makeSoundRow({ label: 'Входящие сообщения', description: 'Сигнал нового сообщения в общем чате.', volumeKey: 'incomingMessageVolume', soundKey: 'incomingMessageSound', group: 'incoming', names: messageNames }),
    makeSoundRow({ label: 'Исходящие сообщения', description: 'Подтверждение отправки вашего сообщения.', volumeKey: 'outgoingMessageVolume', soundKey: 'outgoingMessageSound', group: 'outgoing', names: messageNames }),
    makeSoundRow({ label: 'Приглашение в голосовой чат', description: 'Более протяжный сигнал входящего приглашения.', volumeKey: 'voiceInviteVolume', soundKey: 'voiceInviteSound', group: 'invite', names: inviteNames })
  ];
  const devicesTitle = document.createElement('div'); devicesTitle.className = 'sound-section-title device-section-title'; devicesTitle.innerHTML = '<div><strong>Устройства голосового чата</strong><small>Выбор применяется сразу, если вы уже подключены, или при следующем входе в канал.</small></div>';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Обновить устройства'; refresh.className = 'refresh-devices'; devicesTitle.append(refresh); sound.append(devicesTitle);
  const deviceBox = document.createElement('div'); deviceBox.className = 'audio-device-grid';
  const makeDevice = (label, kind) => { const wrap = document.createElement('label'); const span = document.createElement('span'); span.textContent = label; const select = document.createElement('select'); select.dataset.deviceKind = kind; wrap.append(span, select); deviceBox.append(wrap); return select; };
  const input = makeDevice('Микрофон', 'audioinput'); const output = makeDevice('Устройство вывода', 'audiooutput');
  sound.append(deviceBox);
  const fillDevices = async ({ requestAccess = false } = {}) => {
    let permissionStream;
    if (requestAccess) {
      try {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        window.radmincraftToast?.('Windows не дала доступ к микрофону');
      } finally {
        permissionStream?.getTracks().forEach(track => track.stop());
      }
    }
    let all = []; try { all = await navigator.mediaDevices.enumerateDevices(); } catch {} const saved = await window.radmincraft.loadSettings();
    const fill = (select, kind, selected, fallback) => { select.replaceChildren(); const system = document.createElement('option'); system.value = ''; system.textContent = 'По умолчанию Windows'; select.append(system); all.filter(device => device.kind === kind).forEach((device, index) => { const option = document.createElement('option'); option.value = device.deviceId; option.textContent = device.label || `${fallback} ${index + 1}`; option.selected = device.deviceId === selected; select.append(option); }); };
    fill(input, 'audioinput', saved.voiceDevices?.inputId, 'Микрофон'); fill(output, 'audiooutput', saved.voiceDevices?.outputId, 'Устройство');
  };
  input.addEventListener('change', async () => { const saved = await window.radmincraft.loadSettings(); await window.radmincraft.saveSettings({ voiceDevices: { ...(saved.voiceDevices || {}), inputId: input.value } }); try { await window.radmincraftVoiceSetInput?.(input.value); window.radmincraftToast?.('Настройки применены'); } catch { await fillDevices(); } });
  output.addEventListener('change', async () => { const saved = await window.radmincraft.loadSettings(); await window.radmincraft.saveSettings({ voiceDevices: { ...(saved.voiceDevices || {}), outputId: output.value } }); await window.radmincraftVoiceSetOutput?.(output.value); window.radmincraftToast?.('Настройки применены'); });
  refresh.addEventListener('click', () => fillDevices({ requestAccess: true })); navigator.mediaDevices?.addEventListener?.('devicechange', () => fillDevices());
  window.radmincraft.loadSettings().then(saved => {
    const isHost = saved.mode === 'host';
    buttons.host.hidden = !isHost;
    panes.host.dataset.host = String(isHost);
    soundRows.forEach(item => {
      item.select.value = saved[item.soundKey] || item.select.options[0].value;
      item.range.value = saved[item.volumeKey] ?? 100;
      item.output.textContent = `${item.range.value}%`;
      setRangeFill(item.range);
    });
    if (voiceVolume) setRangeFill(voiceVolume);
    fillDevices();
  });
})();
