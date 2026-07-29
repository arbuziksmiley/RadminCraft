(() => {
  const save = document.querySelector('#host-save-settings');
  const hostPane = window.radmincraftSettings?.panes?.host;
  if (!save || !hostPane || !window.radmincraft) return;
  const section = hostPane.querySelector('.host-basics-card');
  const actions = section?.querySelector('.host-settings-actions');

  const row = document.createElement('div');
  row.className = 'setting-item-clean host-only-setting';
  row.innerHTML = `
    <div class="setting-copy">
      <strong>Версия Minecraft</strong>
      <small>Показывается участникам рядом с названием сообщества.</small>
    </div>`;
  const input = document.createElement('input');
  input.id = 'mc-version';
  input.maxLength = 40;
  input.placeholder = 'Например: 1.20.1 Forge';
  row.append(input);
  if (section && actions) section.insertBefore(row, actions);
  else hostPane.append(row);

  const badge = document.querySelector('#chat header h1 em');
  let savedVersion = '';
  let hasUnsavedVersion = false;
  const refresh = async () => {
    const settings = await window.radmincraft.loadSettings();
    const currentVersion = settings.mcVersion || '1.20.1 Forge';
    if (!hasUnsavedVersion && document.activeElement !== input) {
      input.value = currentVersion;
      savedVersion = currentVersion;
    }
  };
  refresh();
  window.addEventListener('radmincraft:connection-changed', refresh);
  input.addEventListener('input', () => {
    hasUnsavedVersion = input.value.trim() !== savedVersion;
    if (hasUnsavedVersion) window.radmincraftMarkDirty?.(save);
  });

  save.addEventListener('click', async () => {
    const settings = await window.radmincraft.loadSettings();
    if (settings.mode !== 'host') return;
    const mcVersion = input.value.trim().slice(0, 40) || '1.20.1 Forge';
    await window.radmincraft.saveSettings({ mcVersion });
    input.value = mcVersion;
    savedVersion = mcVersion;
    hasUnsavedVersion = false;
    if (badge) badge.textContent = mcVersion;
  });
})();
