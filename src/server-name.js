(() => {
  const titles = [...document.querySelectorAll('#chat header h1, #voice .row h2')];
  const panel = document.querySelector('.settings');
  const hostPane = window.radmincraftSettings?.panes?.host || panel;
  if (!titles.length || !panel || !hostPane) return;
  const section = document.createElement('section');
  section.className = 'settings-section-card host-basics-card host-only-setting';
  section.innerHTML = `
    <div class="settings-section-heading">
      <div>
        <strong>Сведения о сервере</strong>
        <small>Это увидят все участники сообщества.</small>
      </div>
    </div>`;
  const input = document.createElement('input');
  input.id = 'server-name'; input.maxLength = 48; input.placeholder = 'Например: MagasCraft';
  const row = document.createElement('div'); row.className = 'setting-item-clean host-only-setting';
  row.innerHTML = '<div class="setting-copy"><strong>Название сервера</strong><small>Показывается всем участникам в заголовке приложения.</small></div>';
  row.append(input);
  const actions = document.createElement('div');
  actions.className = 'host-settings-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.id = 'host-save-settings';
  save.textContent = 'Сохранить изменения';
  save.disabled = true;
  actions.append(save);
  section.append(row, actions);
  hostPane.prepend(section);
  let savedName = '';
  let hasUnsavedName = false;
  const setTitle = name => {
    const title = name || 'Мой сервер';
    titles.forEach(element => { if (element.firstChild) element.firstChild.textContent = `${title} `; });
  };
  window.setServerName = setTitle;
  const refreshAccess = async () => {
    const settings = await window.radmincraft.loadSettings();
    const currentName = settings.serverName || 'Мой сервер';
    input.disabled = settings.mode !== 'host';
    input.title = input.disabled ? 'Название задаёт владелец Host' : 'Название увидят все участники';
    if (!hasUnsavedName && document.activeElement !== input) {
      input.value = currentName;
      savedName = currentName;
    }
    setTitle(currentName);
  };
  input.addEventListener('input', () => {
    hasUnsavedName = input.value.trim() !== savedName;
    if (hasUnsavedName) window.radmincraftMarkDirty?.(save);
  });
  refreshAccess(); window.addEventListener('radmincraft:connection-changed', refreshAccess);
  save.addEventListener('click', async () => {
    const name = input.value.trim() || 'Мой сервер';
    const settings = await window.radmincraft.loadSettings();
    if (settings.mode !== 'host') return;
    await window.radmincraft.saveSettings({ serverName: name });
    input.value = name;
    savedName = name;
    hasUnsavedName = false;
    setTitle(name);
    window.radmincraftMarkSaved?.(save);
    window.radmincraftToast?.('Сведения о сервере сохранены');
    window.dispatchEvent(new Event('radmincraft:connection-changed'));
  });
})();
