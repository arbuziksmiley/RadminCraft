(() => {
  const soundScript = document.createElement('script');
  soundScript.src = 'ui-sounds.js';
  soundScript.async = false;
  document.head.append(soundScript);
  const panel = document.querySelector('.settings');
  if (!panel) return;
  const launcher = document.querySelector('#launcher-path');
  const volume = document.querySelector('#volume');
  const volumeOut = document.querySelector('#volume-out');
  const notify = document.querySelector('#notify');
  const save = document.querySelector('#save-settings');
  if (![launcher, volume, volumeOut, notify, save].every(Boolean)) return;
  const makeRow = (title, description, control) => {
    const row = document.createElement('div');
    row.className = 'setting-item-clean';
    const copy = document.createElement('div');
    copy.className = 'setting-copy';
    const name = document.createElement('strong'); name.textContent = title;
    const note = document.createElement('small'); note.textContent = description;
    copy.append(name, note); row.append(copy, control); return row;
  };
  panel.replaceChildren();
  panel.append(makeRow('Путь к лаунчеру Minecraft', 'Открывается только на вашем компьютере.', launcher));
  const range = document.createElement('div'); range.className = 'range-clean'; range.append(volumeOut, volume);
  panel.append(makeRow('Громкость голосового чата', 'Общая громкость участников в голосовом канале.', range));
  panel.append(makeRow('Показывать уведомления', 'Всплывают поверх других окон, даже когда RadminCraft свёрнут.', notify));
  panel.append(save);
})();
