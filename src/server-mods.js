(() => {
  const stack = document.querySelector('#chat .stack');
  const launcherCard = document.querySelector('#launch')?.closest('.card');
  if (!stack || !launcherCard || !window.radmincraft?.getLanStatus) return;

  const card = document.createElement('article');
  card.className = 'card mods-card';
  card.innerHTML = `
    <div class="mods-heading"><div><em>Сервер</em><h2>Моды сервера</h2></div><button type="button" class="mods-help" aria-label="Что такое моды сервера">?</button></div>
    <p data-mods-status>Проверяем ссылку на сборку…</p>
    <div class="mods-actions"><button type="button" data-mods-open>Открыть</button><button type="button" data-mods-edit hidden>Добавить ссылку</button></div>
    <form class="mods-form" hidden><label>Ссылка на актуальную сборку модов<input type="url" placeholder="https://disk.yandex.ru/…" autocomplete="url"></label><small>Загрузите ZIP-архив сборки в облако и вставьте публичную ссылку для друзей.</small><div><button type="submit">Сохранить</button><button type="button" data-mods-cancel>Отмена</button></div><span role="alert"></span></form>
    <div class="mods-tip" role="tooltip">Host публикует здесь ссылку на актуальную сборку. Игрок скачивает архив и переносит моды в папку <b>.minecraft\\mods</b>.</div>`;
  stack.insertBefore(card, launcherCard);

  const statusText = card.querySelector('[data-mods-status]');
  const open = card.querySelector('[data-mods-open]');
  const edit = card.querySelector('[data-mods-edit]');
  const help = card.querySelector('.mods-help');
  const tip = card.querySelector('.mods-tip');
  const form = card.querySelector('.mods-form');
  const input = form.querySelector('input');
  const error = form.querySelector('[role="alert"]');
  let currentUrl = '';
  const hostPane = window.radmincraftSettings?.panes?.host;
  let hostModsInput;
  if (hostPane) {
    const hostMods = document.createElement('section');
    hostMods.className = 'settings-section-card host-mods-setting';
    hostMods.innerHTML = `
      <div class="setting-copy">
        <strong>Сборка модов для игроков</strong>
        <small>Та же ссылка показывается в карточке «Моды сервера» на главной странице.</small>
      </div>
      <div class="host-inline-control">
        <input type="url" placeholder="https://disk.yandex.ru/…" autocomplete="url">
        <button type="button">Сохранить</button>
      </div>
      <small class="host-field-error" role="alert"></small>`;
    hostPane.append(hostMods);
    hostModsInput = hostMods.querySelector('input');
    const hostSave = hostMods.querySelector('button');
    const hostError = hostMods.querySelector('[role="alert"]');
    hostSave.addEventListener('click', async () => {
      const value = hostModsInput.value.trim();
      if (value && !/^https?:\/\//i.test(value)) {
        hostError.textContent = 'Ссылка должна начинаться с http:// или https://';
        return;
      }
      hostError.textContent = '';
      await window.radmincraft.saveSettings({ modsUrl: value });
      currentUrl = value;
      hostSave.disabled = true;
      hostSave.textContent = 'Сохранено';
      await refresh();
      window.setTimeout(() => { hostSave.disabled = false; hostSave.textContent = 'Сохранить'; }, 1400);
    });
  }

  const refresh = async () => {
    const [settings, status] = await Promise.all([window.radmincraft.loadSettings(), window.radmincraft.getLanStatus()]);
    const isHost = settings.mode === 'host';
    currentUrl = String(isHost ? settings.modsUrl || '' : status.modsUrl || '').trim();
    edit.hidden = !isHost;
    edit.textContent = currentUrl ? 'Изменить ссылку' : 'Добавить ссылку';
    open.disabled = !currentUrl;
    statusText.textContent = currentUrl ? 'Актуальная сборка готова к скачиванию.' : (isHost ? 'Добавьте ссылку на архив со сборкой модов.' : 'Host пока не добавил ссылку на сборку.');
    if (hostModsInput && document.activeElement !== hostModsInput) hostModsInput.value = currentUrl;
  };
  const submit = form.querySelector('[type="submit"]');
  const setForm = visible => { form.hidden = !visible; edit.setAttribute('aria-expanded', String(visible)); if (visible) { input.value = currentUrl; error.textContent = ''; submit.textContent = 'Сохранить'; submit.classList.remove('is-saved'); submit.disabled = true; input.focus(); } };
  input.addEventListener('input', () => { submit.disabled = input.value.trim() === currentUrl; submit.classList.remove('is-saved'); submit.textContent = 'Сохранить'; });
  open.addEventListener('click', () => { if (currentUrl) window.radmincraft.openMods(currentUrl); });
  edit.addEventListener('click', () => setForm(form.hidden));
  form.querySelector('[data-mods-cancel]').addEventListener('click', () => setForm(false));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const value = input.value.trim();
    if (value && !/^https?:\/\//i.test(value)) { error.textContent = 'Ссылка должна начинаться с http:// или https://'; return; }
    submit.disabled = true; submit.textContent = 'Сохранено'; submit.classList.add('is-saved');
    await window.radmincraft.saveSettings({ modsUrl: value });
    currentUrl = value; await refresh();
    window.setTimeout(() => { submit.textContent = 'Сохранить'; submit.classList.remove('is-saved'); submit.disabled = false; setForm(false); }, 500);
  });
  help.addEventListener('click', () => { tip.classList.toggle('is-visible'); help.setAttribute('aria-expanded', String(tip.classList.contains('is-visible'))); });
  document.addEventListener('click', event => { if (!card.contains(event.target)) tip.classList.remove('is-visible'); });
  refresh(); window.setInterval(refresh, 5000);
})();
