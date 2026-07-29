(() => {
  const saveLabels = new WeakMap();
  const rememberSave = button => { if (button && !saveLabels.has(button)) saveLabels.set(button, button.textContent.trim()); };
  const setClean = (button, saved = false) => {
    if (!button) return;
    rememberSave(button); button.disabled = true; button.classList.toggle('is-saved', saved);
    button.textContent = saved ? 'Сохранено' : saveLabels.get(button);
  };
  const setDirty = button => {
    if (!button) return;
    rememberSave(button); button.disabled = false; button.classList.remove('is-saved'); button.textContent = saveLabels.get(button);
  };
  window.radmincraftMarkSaved = button => setClean(button, true);
  window.radmincraftMarkDirty = button => setDirty(button);
  window.radmincraftCopyFeedback = async (button, value, idleLabel = 'Копировать') => {
    await navigator.clipboard.writeText(String(value));
    button.disabled = true; button.classList.add('is-copied'); button.textContent = 'Скопировано';
    window.setTimeout(() => { button.disabled = false; button.classList.remove('is-copied'); button.textContent = idleLabel; }, 1600);
  };
  const confirmDanger = ({ title, text, action, finalTitle = 'Подтвердите ещё раз' }) => new Promise(resolve => {
    const backdrop = document.createElement('div'); backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `<section class="confirm-dialog" role="alertdialog" aria-modal="true"><h2></h2><p></p><div class="confirm-actions"><button type="button" data-cancel>Отмена</button><button type="button" class="danger" data-confirm></button></div></section>`;
    const heading = backdrop.querySelector('h2'); const copy = backdrop.querySelector('p'); const confirm = backdrop.querySelector('[data-confirm]');
    heading.textContent = title; copy.textContent = text; confirm.textContent = action; document.body.append(backdrop); confirm.focus();
    let onKey; const close = value => { document.removeEventListener('keydown', onKey); backdrop.remove(); resolve(value); };
    onKey = event => { if (event.key === 'Escape') close(false); }; document.addEventListener('keydown', onKey);
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(false); });
    confirm.addEventListener('click', () => {
      heading.textContent = finalTitle; copy.textContent = 'Это действие нельзя отменить. Нажмите кнопку ещё раз, только если уверены.'; confirm.textContent = action;
      confirm.replaceWith(confirm.cloneNode(true)); const finalButton = backdrop.querySelector('[data-confirm]'); finalButton.addEventListener('click', () => close(true)); finalButton.focus();
    }, { once: true });
  });
  window.radmincraftConfirmDanger = confirmDanger;
  const chooseSetupReset = () => new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog setup-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-reset-title">
        <header class="setup-reset-header">
          <div>
            <span>Повторная настройка</span>
            <h2 id="setup-reset-title">Что оставить?</h2>
            <p>История чата сохранится в любом случае.</p>
          </div>
          <button type="button" class="dialog-close" data-cancel aria-label="Закрыть">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>
          </button>
        </header>
        <div class="setup-reset-options">
          <button type="button" data-choice="keep">
            <span class="setup-reset-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5zM8 4v6h8V4M8 20v-6h8v6"/></svg>
            </span>
            <span><strong>Оставить настройки</strong><small>Имя, аватар, сервер, звуки и пути останутся заполненными.</small></span>
            <svg class="setup-reset-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
          </button>
          <button type="button" data-choice="reset">
            <span class="setup-reset-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2-5.3L4 9M4 4v5h5"/></svg>
            </span>
            <span><strong>Начать с чистого листа</strong><small>Сбросить профиль и параметры приложения.</small></span>
            <svg class="setup-reset-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
          </button>
        </div>
        <p class="setup-reset-footnote">Minecraft-пути, карта, ссылка на моды и уведомления также будут сброшены.</p>
      </section>`;
    document.body.append(backdrop);
    const close = value => { backdrop.remove(); resolve(value); };
    backdrop.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => close(button.dataset.choice)));
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => close(''));
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(''); });
  });
  const launcher = document.querySelector('#launcher-path');
  if (launcher) {
    const parent = launcher.parentElement;
    const picker = document.createElement('div'); picker.className = 'launcher-picker';
    const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = 'Выбрать файл';
    parent.replaceChild(picker, launcher); picker.append(launcher, choose);
    choose.addEventListener('click', async () => { const selected = await window.radmincraft.chooseLauncher(); if (selected) { launcher.value = selected; launcher.dispatchEvent(new Event('input', { bubbles: true })); } });
  }
  window.radmincraft.loadMessages().then(saved => {
    if (!Array.isArray(saved) || !saved.length) return;
    messages.splice(0, messages.length, ...saved); render();
  });
  document.querySelector('#chat-form')?.addEventListener('submit', () => {
    queueMicrotask(() => window.radmincraft.saveMessages(messages));
  });
  const avatarOptions = document.querySelector('#avatars');
  const profileAvatar = document.querySelector('#profile-avatar');
  const selfAvatar = document.querySelector('#self-avatar');
  let selectedAvatar = 'head-000';
  const showPreviewAvatar = avatarId => window.RadminCraftAvatars?.paint(profileAvatar, avatarId);
  const showCommittedAvatar = avatarId => window.RadminCraftAvatars?.paint(selfAvatar, avatarId);
  if (avatarOptions) {
    avatarOptions.className = 'avatar-picker-grid'; avatarOptions.replaceChildren();
    Array.from({ length: window.RadminCraftAvatars.count }, (_, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.avatar = window.RadminCraftAvatars.id(index); button.title = `Голова ${index + 1}`;
      button.append(window.RadminCraftAvatars.create(button.dataset.avatar));
      button.addEventListener('click', () => { selectedAvatar = button.dataset.avatar; avatar = selectedAvatar; avatarOptions.querySelector('.is-selected')?.classList.remove('is-selected'); button.classList.add('is-selected'); showPreviewAvatar(selectedAvatar); setDirty(document.querySelector('#save-profile')); });
      avatarOptions.append(button);
    });
  }
  window.radmincraft.loadSettings().then(settings => {
    selectedAvatar = window.RadminCraftAvatars.normalize(settings.avatar);
    avatar = selectedAvatar;
    showPreviewAvatar(selectedAvatar);
    showCommittedAvatar(selectedAvatar);
    avatarOptions?.querySelector(`[data-avatar="${selectedAvatar}"]`)?.classList.add('is-selected');
  });
  const settingsPanel = document.querySelector('.settings');
  const settingsSave = document.querySelector('#save-settings');
  const settingsHeader = settingsPanel?.closest('.page')?.querySelector('header p');
  if (settingsHeader) settingsHeader.remove();
  if (settingsPanel && settingsSave) {
    const rerunSetup = document.createElement('button'); rerunSetup.type = 'button'; rerunSetup.className = 'rerun-setup'; rerunSetup.textContent = 'Настроить подключение заново';
    const actions = document.createElement('div'); actions.className = 'settings-actions'; actions.append(settingsSave); settingsPanel.append(actions);
    const connectionTools = document.createElement('section'); connectionTools.className = 'settings-more';
    const connectionToolsTitle = document.createElement('div'); connectionToolsTitle.className = 'settings-section-heading'; connectionToolsTitle.textContent = 'Настройка подключения';
    const connectionToolsBody = document.createElement('div'); connectionToolsBody.className = 'settings-more-body';
    connectionToolsBody.innerHTML = '<div><strong>Перезапустить мастер подключения</strong><small>Можно заново выбрать роль Host или обычного игрока, не удаляя профиль и историю.</small></div>';
    connectionToolsBody.append(rerunSetup); connectionTools.append(connectionToolsTitle, connectionToolsBody); actions.append(connectionTools);
    rerunSetup.addEventListener('click', async () => {
      const current = await window.radmincraft.loadSettings();
      if (current.mode === 'host') {
        const accepted = await confirmDanger({ title: 'Остановить Host и настроить подключение заново?', text: 'Все клиенты сразу потеряют чат, голос, карту и связь с Forge Bridge.', action: 'Остановить Host' });
        if (!accepted) return;
      }
      const choice = await chooseSetupReset();
      if (!choice) return;
      const patch = { mode: 'client', hostAddress: '', onboardingCompleted: false };
      if (choice === 'reset') Object.assign(patch, {
        displayName: 'Вы',
        avatar: 'head-000',
        serverName: 'Мой сервер',
        launcherPath: '',
        notificationsEnabled: true,
        notifyChatAll: false,
        notifyMentions: true,
        notifyVoiceInvite: true,
        notifyPlayerJoin: true,
        volume: 70,
        incomingMessageVolume: 100,
        outgoingMessageVolume: 100,
        voiceInviteVolume: 100,
        incomingMessageSound: 'message-3',
        outgoingMessageSound: 'message-4',
        voiceInviteSound: 'invite-4',
        serverPath: '',
        mapPort: 8100,
        mapUrl: '',
        modsUrl: '',
        mcNickname: '',
        serverBridgeConfigured: false
      });
      await window.radmincraft.saveSettings(patch);
      window.location.reload();
    });
  }
  const profile = document.querySelector('.profile');
  const profileSave = document.querySelector('#save-profile');
  // The Host verifies an ordinary Minecraft chat message through latest.log,
  // so this works on a dedicated Forge server without an extra mod or plugin.
  if (profile && profileSave && window.radmincraft?.requestMinecraftLink) {
    const link = document.createElement('section'); link.className = 'minecraft-link'; link.id = 'minecraft-profile-link';
    profile.insertBefore(link, profileSave);
    let linkTimer;
    let activeCode = '';
    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    const renderIdle = async () => {
      clearInterval(linkTimer);
      activeCode = '';
      const [saved, bridge] = await Promise.all([
        window.radmincraft.loadSettings(),
        window.radmincraft.getBridgeStatus?.() || Promise.resolve({ linkAvailable: false })
      ]);
      if (saved.mcNickname) {
        link.innerHTML = `<div class="minecraft-link-copy"><strong>Minecraft подключён</strong><p class="muted">Игровой ник: <b>${escapeHtml(saved.mcNickname)}</b>. Если вы сменили игровой аккаунт или сервер, подтвердите связь заново.</p></div><div class="minecraft-link-actions"><span class="minecraft-link-state is-linked">Привязано</span><button type="button" class="minecraft-relink" data-relink>Перепривязать</button></div>`;
        link.querySelector('[data-relink]').addEventListener('click', generate);
        return;
      }
      if (!bridge?.linkAvailable) {
        link.innerHTML = '<div class="minecraft-link-copy"><strong>Привязка Minecraft пока недоступна</strong><p class="muted">Host ещё не подключил журнал Minecraft или Forge Bridge. Код появится после завершения настройки Host.</p></div><span class="minecraft-link-state">Не настроено Host</span>';
        return;
      }
      link.innerHTML = '<div class="minecraft-link-copy"><strong>Привязка Minecraft</strong><p class="muted">Получите код и введите его в чат Minecraft на сервере. После этого игровой профиль будет связан с RadminCraft.</p></div><div class="minecraft-link-actions"><button type="button" data-generate>Получить код</button></div>';
      link.querySelector('[data-generate]').addEventListener('click', generate);
    };
    const generate = async () => {
      const generateButton = link.querySelector('[data-generate]');
      if (generateButton) {
        generateButton.disabled = true;
        generateButton.textContent = 'Создаём код…';
      }
      const requested = await window.radmincraft.requestMinecraftLink();
      if (!requested?.ok) {
        window.radmincraftToast?.(requested?.reason === 'bridge-not-configured'
          ? 'Host ещё не настроил интеграцию с Minecraft'
          : 'Не удалось создать код: проверьте подключение к Host');
        renderIdle();
        return;
      }
      const code = requested.code;
      const command = requested.command;
      activeCode = code;
      link.innerHTML = `<div class="minecraft-link-copy"><strong>Отправьте это сообщение в игровой чат</strong><span class="link-status">Без символа / в начале. Код действует 5 минут.</span></div><div class="minecraft-command"><code>${command}</code><button type="button" data-copy>Копировать</button><button type="button" data-cancel>Отменить</button></div>`;
      clearInterval(linkTimer);
      const status = link.querySelector('.link-status');
      let deadline = Number(requested.expiresAt) || (Date.now() + 5 * 60 * 1000);
      let polling = false;
      const tick = async () => {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        status.textContent = `Код действует ещё ${minutes}:${String(seconds).padStart(2, '0')}.`;
        if (remaining <= 0) {
          clearInterval(linkTimer);
          await renderIdle();
          return;
        }
        if (polling) return;
        polling = true;
        try {
          const result = await window.radmincraft.getMinecraftLinkStatus(code);
          if (Number(result?.expiresAt)) deadline = Number(result.expiresAt);
          if (result?.linked) {
            clearInterval(linkTimer);
            await renderIdle();
            window.radmincraftToast?.('Профиль Minecraft привязан');
            window.dispatchEvent(new Event('radmincraft:connection-changed'));
          }
        } finally { polling = false; }
      };
      tick(); linkTimer = setInterval(tick, 1000);
      link.querySelector('[data-copy]').addEventListener('click', event => window.radmincraftCopyFeedback(event.currentTarget, command));
      link.querySelector('[data-cancel]').addEventListener('click', async () => {
        await window.radmincraft.cancelMinecraftLink(activeCode);
        renderIdle();
      });
    };
    renderIdle();
    window.radmincraftOpenMinecraftLink = async () => {
      document.querySelector('.nav[data-page="profile"]')?.click();
      await renderIdle();
      window.requestAnimationFrame(() => {
        link.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => link.querySelector('[data-generate]')?.focus(), 350);
      });
    };
    window.dispatchEvent(new Event('radmincraft:minecraft-link-ready'));
  }

  const chatHeader = document.querySelector('#chat > header');
  if (chatHeader && window.radmincraft?.getBridgeStatus) {
    const center = document.createElement('div');
    center.className = 'notification-center';
    center.innerHTML = `
      <button type="button" class="notification-bell" aria-label="Уведомления" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
        <span class="notification-badge" hidden>0</span>
      </button>
      <section class="notification-panel" hidden>
        <header><strong>Уведомления</strong><small>RadminCraft</small></header>
        <div class="notification-items"></div>
      </section>`;
    chatHeader.append(center);
    const bell = center.querySelector('.notification-bell');
    const badge = center.querySelector('.notification-badge');
    const panel = center.querySelector('.notification-panel');
    const items = center.querySelector('.notification-items');
    let linkNotice = null;
    let integrationNotice = null;
    let updateState = null;

    const openUpdateDialog = () => {
      document.querySelector('.update-dialog-backdrop')?.remove();
      const state = updateState || {};
      const backdrop = document.createElement('div');
      backdrop.className = 'confirm-backdrop update-dialog-backdrop';
      backdrop.innerHTML = `
        <section class="confirm-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
          <header>
            <div>
              <span>Обновление RadminCraft</span>
              <h2 id="update-dialog-title"></h2>
              <p data-update-description></p>
            </div>
            <button type="button" class="icon-button" data-close aria-label="Закрыть">×</button>
          </header>
          <div class="update-progress" hidden><span></span></div>
          <footer>
            <button type="button" class="secondary" data-secondary></button>
            <button type="button" data-primary></button>
          </footer>
        </section>`;
      document.body.append(backdrop);
      const title = backdrop.querySelector('h2');
      const description = backdrop.querySelector('[data-update-description]');
      const primary = backdrop.querySelector('[data-primary]');
      const secondary = backdrop.querySelector('[data-secondary]');
      const progress = backdrop.querySelector('.update-progress');
      let unsubscribe = () => {};
      const close = () => {
        unsubscribe();
        backdrop.remove();
      };
      backdrop.querySelector('[data-close]').addEventListener('click', close);
      backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });

      const refresh = next => {
        updateState = next || updateState || {};
        const status = updateState.status;
        const version = updateState.version ? ` ${updateState.version}` : '';
        progress.hidden = status !== 'downloading';
        progress.querySelector('span').style.width = `${updateState.percent || 0}%`;
        title.textContent = status === 'downloaded'
          ? `Версия${version} готова к установке`
          : status === 'downloading'
            ? `Скачиваем версию${version}`
            : status === 'error'
              ? 'Не удалось проверить обновление'
              : status === 'current'
                ? 'У вас актуальная версия'
                : `Доступна версия${version}`;
        description.textContent = status === 'downloaded'
          ? 'RadminCraft перезапустится, установит обновление и сохранит ваш профиль, историю и настройки.'
          : status === 'downloading'
            ? `Загружено ${updateState.percent || 0}%. Окно можно закрыть — скачивание продолжится.`
            : status === 'error'
              ? (updateState.message || 'Проверьте интернет и повторите попытку позже.')
              : status === 'current'
                ? `Установлена последняя версия ${updateState.currentVersion || ''}.`
                : 'Обновление загружается только после вашего подтверждения.';
        primary.hidden = status === 'current';
        secondary.hidden = status === 'current' || status === 'downloading' || status === 'downloaded';
        primary.disabled = status === 'downloading' || status === 'checking';
        primary.textContent = status === 'downloaded'
          ? 'Перезапустить и установить'
          : status === 'error'
            ? 'Проверить снова'
            : status === 'current'
              ? ''
              : status === 'checking'
                ? 'Проверяем…'
                : 'Скачать обновление';
        secondary.textContent = 'Напомнить через 2 дня';
      };
      refresh(state);

      primary.addEventListener('click', async () => {
        if (updateState?.status === 'downloaded') {
          await window.radmincraft.installUpdate();
          return;
        }
        const next = updateState?.status === 'error'
          ? await window.radmincraft.checkForUpdates()
          : await window.radmincraft.downloadUpdate();
        refresh(next);
      });
      secondary.addEventListener('click', async () => {
        await window.radmincraft.deferUpdate();
        close();
        refreshNotifications();
      });
      unsubscribe = window.radmincraft.onUpdateState(refresh);
    };

    const renderNotifications = () => {
      items.replaceChildren();
      const addNotice = ({ title, description, icon, action }) => {
        const notice = document.createElement('button');
        notice.type = 'button';
        notice.className = 'notification-item';
        notice.innerHTML = `
          <span class="notification-item-icon" aria-hidden="true"></span>
          <span><strong></strong><small></small></span>`;
        notice.querySelector('.notification-item-icon').innerHTML = icon;
        notice.querySelector('strong').textContent = title;
        notice.querySelector('small').textContent = description;
        notice.addEventListener('click', () => {
          panel.hidden = true;
          bell.setAttribute('aria-expanded', 'false');
          action();
        });
        items.append(notice);
      };
      if (integrationNotice) addNotice({
        title: 'Настроить Minecraft',
        description: integrationNotice,
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v5H4zM4 14h16v5H4z"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
        action: () => window.radmincraftOpenServerSetup?.()
      });
      if (linkNotice) addNotice({
        title: 'Связать профиль Minecraft',
        description: linkNotice,
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10.5 13.5 13.5 10.5"/><path d="M7.8 15.7 5.7 17.8a3 3 0 0 1-4.2-4.2l3.2-3.2a3 3 0 0 1 4.2 0"/><path d="m16.2 8.3 2.1-2.1a3 3 0 0 1 4.2 4.2l-3.2 3.2a3 3 0 0 1-4.2 0"/></svg>',
        action: () => window.radmincraftOpenMinecraftLink?.()
      });
      if (['available', 'downloading', 'downloaded', 'error'].includes(updateState?.status)) addNotice({
        title: updateState.status === 'downloaded'
          ? `RadminCraft ${updateState.version} готов`
          : updateState.status === 'downloading'
            ? `Скачиваем обновление · ${updateState.percent || 0}%`
            : updateState.status === 'error'
              ? 'Проверка обновлений не удалась'
              : `Доступен RadminCraft ${updateState.version}`,
        description: updateState.status === 'downloaded'
          ? 'Перезапустите приложение, чтобы установить новую версию.'
          : updateState.status === 'downloading'
            ? 'Загрузка продолжается в фоне.'
            : updateState.status === 'error'
              ? 'Нажмите, чтобы повторить проверку.'
              : 'Скачать сейчас или отложить напоминание на два дня.',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
        action: openUpdateDialog
      });
      if (!integrationNotice && !linkNotice && !['available', 'downloading', 'downloaded', 'error'].includes(updateState?.status)) {
        const empty = document.createElement('div');
        empty.className = 'notification-empty';
        empty.textContent = 'Новых уведомлений нет';
        items.append(empty);
      }
      const count = Number(Boolean(integrationNotice))
        + Number(Boolean(linkNotice))
        + Number(['available', 'downloading', 'downloaded', 'error'].includes(updateState?.status));
      badge.textContent = String(count);
      badge.hidden = count === 0;
      center.classList.toggle('has-notifications', count > 0);
    };

    const refreshNotifications = async () => {
      const [saved, bridge, updater] = await Promise.all([
        window.radmincraft.loadSettings(),
        window.radmincraft.getBridgeStatus(),
        window.radmincraft.getUpdateState()
      ]);
      updateState = updater;
      const names = Array.isArray(bridge?.playerNames) ? bridge.playerNames.filter(Boolean) : [];
      linkNotice = !saved.mcNickname && bridge?.linkAvailable
        ? (names.length
          ? `Minecraft видит ${names.slice(0, 2).join(', ')}. Получите код и отправьте его из игры, чтобы подтвердить, какой ник принадлежит вам.`
          : 'Получите код и отправьте его в игровой чат, чтобы сообщения и статус относились к вашему профилю.')
        : null;
      integrationNotice = saved.mode === 'host' && !saved.serverBridgeConfigured
        ? 'Подключите Forge Bridge для игрового чата и при необходимости BlueMap для карты.'
        : null;
      renderNotifications();
    };
    bell.addEventListener('click', event => {
      event.stopPropagation();
      panel.hidden = !panel.hidden;
      bell.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) renderNotifications();
    });
    panel.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => {
      panel.hidden = true;
      bell.setAttribute('aria-expanded', 'false');
    });
    refreshNotifications();
    window.addEventListener('radmincraft:connection-changed', refreshNotifications);
    window.radmincraft.onUpdateState(state => {
      updateState = state;
      renderNotifications();
    });
    window.setInterval(refreshNotifications, 15000);
  }
  const profileControls = [document.querySelector('#display-name'), avatarOptions].filter(Boolean);
  const settingsControls = [launcher, document.querySelector('#volume'), document.querySelector('#notify'), document.querySelector('#widget')].filter(Boolean);
  profileControls.forEach(control => { control.addEventListener('input', () => setDirty(document.querySelector('#save-profile'))); control.addEventListener('change', () => setDirty(document.querySelector('#save-profile'))); });
  settingsControls.forEach(control => { control.addEventListener('input', () => setDirty(settingsSave)); control.addEventListener('change', () => setDirty(settingsSave)); });
  window.radmincraft.loadSettings().then(() => window.setTimeout(() => {
    setClean(document.querySelector('#save-profile')); setClean(settingsSave);
  }, 700));
})();

(() => {
  let timer;
  window.radmincraftToast = message => {
    let toast = document.querySelector('.app-feedback-toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'app-feedback-toast'; toast.setAttribute('role', 'status'); document.body.append(toast); }
    toast.textContent = message; toast.classList.add('is-visible');
    clearTimeout(timer); timer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
  };
})();
