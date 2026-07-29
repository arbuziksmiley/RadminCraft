// Per-event notification switches, shown indented under the master
// "Показывать уведомления" toggle that settings-layout.js builds.
(() => {
  const save = document.querySelector('#save-settings');
  const master = document.querySelector('#notify');
  // audio-settings.js owns the tab structure and publishes the panes.
  const pane = window.radmincraftSettings?.panes?.notifications || document.querySelector('.settings');
  if (!pane || !save || !master || !window.radmincraft) return;

  const options = [
    { key: 'notifyChatAll', title: 'Сообщения в чате', note: 'Все подряд, а не только адресованные вам.' },
    { key: 'notifyMentions', title: 'Когда меня упомянули', note: 'Сообщения с @вашим ником.' },
    { key: 'notifyVoiceInvite', title: 'Приглашение в голосовой', note: 'Кто-то зовёт вас в звонок.' },
    { key: 'notifyPlayerJoin', title: 'Друг зашёл на сервер', note: 'Именно вход в игру, а не запуск RadminCraft.' }
  ];

  const group = document.createElement('div');
  group.className = 'notify-group';

  const inputs = new Map();
  options.forEach(option => {
    const row = document.createElement('div');
    row.className = 'setting-item-clean notify-sub';
    const copy = document.createElement('div');
    copy.className = 'setting-copy';
    const name = document.createElement('strong'); name.textContent = option.title;
    const note = document.createElement('small'); note.textContent = option.note;
    copy.append(name, note);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `notify-${option.key}`;
    row.append(copy, input);
    group.append(row);
    inputs.set(option.key, input);
  });

  // Sub-options only make sense while notifications are on at all.
  const syncEnabled = () => {
    group.classList.toggle('is-disabled', !master.checked);
    inputs.forEach(input => { input.disabled = !master.checked; });
  };

  // Move the master switch onto the notifications tab, then nest the per-event
  // options directly under it.
  const masterRow = master.closest('.setting-item-clean');
  if (masterRow) { pane.append(masterRow); masterRow.after(group); }
  else pane.append(group);

  const load = async () => {
    const settings = await window.radmincraft.loadSettings();
    inputs.forEach((input, key) => { input.checked = Boolean(settings[key]); });
    syncEnabled();
  };
  load();

  const startupRow = document.createElement('div');
  startupRow.className = 'setting-item-clean';
  startupRow.innerHTML = '<div class="setting-copy"><strong>Запускать вместе с Windows</strong><small>RadminCraft запустится при входе в систему и будет доступен из трея.</small></div>';
  const startup = document.createElement('input'); startup.type = 'checkbox'; startupRow.append(startup);
  const generalPane = window.radmincraftSettings?.panes?.general || pane;
  const generalActions = generalPane.querySelector('.settings-actions');
  if (generalActions) generalPane.insertBefore(startupRow, generalActions);
  else generalPane.append(startupRow);
  window.radmincraft.loadSettings().then(saved => { startup.checked = Boolean(saved.launchAtStartup); });
  startup.addEventListener('change', async () => {
    await window.radmincraft.saveSettings({ launchAtStartup: startup.checked });
    window.radmincraftToast?.('Настройки применены');
  });

  master.addEventListener('change', syncEnabled);
  inputs.forEach(input => input.addEventListener('change', async () => {
    window.radmincraftMarkDirty?.(save);
    const patch = {}; inputs.forEach((item, key) => { patch[key] = item.checked; });
    await window.radmincraft.saveSettings(patch);
    window.radmincraftToast?.('Настройки применены');
  }));

  save.addEventListener('click', async () => {
    const patch = {};
    inputs.forEach((input, key) => { patch[key] = input.checked; });
    await window.radmincraft.saveSettings(patch);
  });
})();
