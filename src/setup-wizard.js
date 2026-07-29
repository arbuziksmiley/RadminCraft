(() => {
  const open = async savedSettings => {
    const backdrop = document.createElement('div'); backdrop.className = 'setup-backdrop'; document.body.append(backdrop);
    let mode = savedSettings.mode === 'host' ? 'host' : 'client';
    let detectedAddress = '';
    let profileError = '';
    const draft = {
      displayName: savedSettings.displayName === 'Вы' ? '' : savedSettings.displayName || '',
      avatar: window.RadminCraftAvatars.normalize(savedSettings.avatar),
      avatarImage: '',
      serverName: savedSettings.serverName || 'Мой сервер'
    };
    const close = () => backdrop.remove();
    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    const footer = (backLabel, nextLabel) => `<div class="setup-footer">${backLabel ? `<button class="setup-back" type="button"><span>←</span>${backLabel}</button>` : '<span></span>'}<button class="setup-primary" type="button">${nextLabel}</button></div>`;

    const renderWelcome = () => {
      backdrop.innerHTML = '<div class="setup-dialog setup-welcome" role="dialog" aria-modal="true"><div class="setup-welcome-copy"><img class="setup-logo" src="assets/app-icon.png" alt=""><h1>RadminCraft</h1><p>Независимое пространство для вашей совместной игры</p><ul><li>Частная голосовая связь без сторонних сервисов</li><li>Общий чат, упоминания, смайлы и стикеры</li><li>Настраиваемые уведомления и игровые инструменты</li></ul><button class="setup-primary" type="button">Начать</button></div></div>';
      backdrop.querySelector('.setup-primary').addEventListener('click', renderChoice);
    };

    const renderChoice = () => {
      backdrop.innerHTML = '<div class="setup-dialog setup-choice" role="dialog" aria-modal="true"><div class="setup-step"><span>1 из 3</span><i></i><i></i></div><h1>Кем вы хотите быть?</h1><p>Выберите роль в сообществе. Её можно будет изменить позже.</p><div class="setup-modes"><button class="setup-mode" data-mode="host" type="button"><span class="setup-role-icon host-role" aria-hidden="true"><i></i><i></i><i></i></span><strong>Host</strong><small>Создать сообщество, управлять сервером и приглашать друзей.</small><em>Владелец сервера</em></button><button class="setup-mode" data-mode="client" type="button"><span class="setup-role-icon client-role" aria-hidden="true"></span><strong>Обычный игрок</strong><small>Подключиться к Host, общаться, смотреть карту и играть.</small><em>Участник сообщества</em></button></div></div>';
      backdrop.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; renderProfile(); }));
    };

    const renderProfile = () => {
      backdrop.innerHTML = `<div class="setup-dialog setup-profile" role="dialog" aria-modal="true"><div class="setup-step"><i></i><span>2 из 3</span><i></i></div><h1>Создайте профиль</h1><p>Так вас будут видеть друзья в чате и голосовом канале.</p><div class="setup-profile-layout"><div class="setup-avatar-column"><b class="setup-avatar-preview"></b><strong>Ваша голова</strong><small>Выберите одну из 150</small></div><div class="setup-profile-fields"><label>Ваше имя<input data-profile-name maxlength="20" autocomplete="nickname" placeholder="Например: Нагибатор или Angelochek" value="${escapeHtml(draft.displayName.slice(0, 20))}"><span class="setup-name-meta"><small data-name-error aria-live="polite">${escapeHtml(profileError)}</small><small data-name-count>${Math.min(20, draft.displayName.length)}/20</small></span></label><fieldset><legend>Голова персонажа</legend><div class="avatar-picker-grid"></div></fieldset>${mode === 'host' ? `<label>Название сервера<input data-server-name maxlength="48" placeholder="Мой сервер" value="${escapeHtml(draft.serverName)}"><small>Это название увидят все подключившиеся игроки.</small></label>` : ''}</div></div>${footer('К выбору роли', 'Продолжить')}</div>`;
      const nameInput = backdrop.querySelector('[data-profile-name]'); const preview = backdrop.querySelector('.setup-avatar-preview');
      const grid = backdrop.querySelector('.avatar-picker-grid');
      const paintPreview = () => window.RadminCraftAvatars.paint(preview, draft.avatar);
      Array.from({ length: window.RadminCraftAvatars.count }, (_, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.avatar = window.RadminCraftAvatars.id(index); button.title = `Голова ${index + 1}`;
        button.append(window.RadminCraftAvatars.create(button.dataset.avatar)); button.classList.toggle('is-selected', button.dataset.avatar === draft.avatar);
        button.addEventListener('click', () => { draft.avatar = button.dataset.avatar; grid.querySelector('.is-selected')?.classList.remove('is-selected'); button.classList.add('is-selected'); paintPreview(); }); grid.append(button);
      });
      paintPreview(); nameInput.focus();
      nameInput.addEventListener('input', () => {
        draft.displayName = nameInput.value.trimStart().slice(0, 20);
        profileError = '';
        backdrop.querySelector('[data-name-error]').textContent = '';
        backdrop.querySelector('[data-name-count]').textContent = `${draft.displayName.length}/20`;
        nameInput.removeAttribute('aria-invalid');
      });
      backdrop.querySelector('.setup-back').addEventListener('click', renderChoice);
      backdrop.querySelector('.setup-primary').addEventListener('click', () => {
        draft.displayName = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 20); if (!draft.displayName) { nameInput.setAttribute('aria-invalid', 'true'); nameInput.focus(); return; }
        const serverInput = backdrop.querySelector('[data-server-name]'); if (serverInput) draft.serverName = serverInput.value.trim() || 'Мой сервер'; renderConnection();
      });
    };

    const loading = async () => {
      backdrop.innerHTML = '<div class="setup-dialog setup-loading"><span class="setup-spinner"></span><h1>Подключаем RadminCraft</h1><p>Проверяем соединение…</p></div>';
      const status = await window.radmincraft.getLanStatus(); const text = backdrop.querySelector('p');
      if (status.ok) {
        const identity = await window.radmincraft.getPublicIdentity();
        const nameCheck = await window.radmincraft.checkDisplayName({ id: identity.deviceId, name: draft.displayName });
        if (!nameCheck.ok || !nameCheck.available) {
          profileError = nameCheck.reason === 'name-taken' || nameCheck.ok ? 'Этот ник уже занят. Выберите другой.' : 'Не удалось проверить ник. Повторите подключение.';
          await window.radmincraft.saveSettings({ onboardingCompleted: false });
          renderProfile();
          return;
        }
        await window.radmincraft.saveSettings({ onboardingCompleted: true });
        text.textContent = mode === 'host' ? 'Host запущен. Можно приглашать друзей.' : `Подключено к ${status.serverName || 'Host'}.`;
        window.dispatchEvent(new Event('radmincraft:connection-changed'));
        // renderer.js loaded the pre-onboarding defaults before this wizard
        // saved the chosen name/avatar. Reload once so every consumer (sidebar,
        // profile, presence and chat composer) starts from the same settings.
        window.setTimeout(() => window.location.reload(), 450);
        return;
      }
      backdrop.querySelector('.setup-dialog').classList.remove('setup-loading');
      backdrop.querySelector('.setup-dialog').classList.add('setup-connect-error');
      backdrop.querySelector('.setup-spinner')?.remove();
      text.textContent = status.reason === 'radmin-vpn-unavailable'
        ? 'Radmin VPN не запущен. Откройте Radmin VPN, подключитесь к своей сети и повторите проверку.'
        : mode === 'host' ? 'Не удалось запустить Host. Проверьте, свободен ли порт 18483.' : 'Host не отвечает. Проверьте Radmin VPN и введённый IP-адрес.';
      const actions = document.createElement('div'); actions.className = 'setup-footer'; actions.innerHTML = '<button class="setup-back" type="button"><span>←</span>Изменить данные</button><button class="setup-primary" type="button">Повторить</button>'; backdrop.querySelector('.setup-dialog').append(actions);
      actions.querySelector('.setup-back').addEventListener('click', renderConnection); actions.querySelector('.setup-primary').addEventListener('click', loading);
    };

    const start = async hostAddress => {
      await window.radmincraft.saveSettings({ mode, hostAddress, onboardingCompleted: false, displayName: draft.displayName, avatar: draft.avatar, avatarImage: draft.avatarImage, serverName: draft.serverName });
      loading();
    };

    const renderConnection = async () => {
      const hostMode = mode === 'host';
      const vpn = await window.radmincraft.getRadminVpnStatus();
      detectedAddress = vpn?.detected ? vpn.address : '';
      if (!vpn?.detected) {
        backdrop.innerHTML = `<div class="setup-dialog setup-connect setup-connect-error" role="dialog" aria-modal="true"><div class="setup-step"><i></i><i></i><span>3 из 3</span></div><h1>Radmin VPN не запущен</h1><p>Откройте Radmin VPN и подключитесь к своей сети. Без активного Radmin VPN ${hostMode ? 'создать Host' : 'подключиться к Host'} нельзя.</p><section class="setup-vpn-required"><strong>Что проверить</strong><span>Окно Radmin VPN открыто, ваша частная сеть подключена, а у компьютера появился адрес вида 26.x.x.x.</span></section>${footer('К профилю', 'Проверить снова')}</div>`;
        backdrop.querySelector('.setup-back').addEventListener('click', renderProfile);
        backdrop.querySelector('.setup-primary').addEventListener('click', renderConnection);
        return;
      }
      backdrop.innerHTML = `<div class="setup-dialog setup-connect" role="dialog" aria-modal="true"><div class="setup-step"><i></i><i></i><span>3 из 3</span></div><h1>${hostMode ? 'Создание Host' : 'Подключение к Host'}</h1><p>${hostMode ? 'RadminCraft нашёл адрес Radmin VPN автоматически.' : 'Введите IP-адрес Radmin VPN владельца Host в вашей сети.'}</p>${hostMode ? `<section class="setup-host-summary"><div><small>Название сервера</small><strong>${escapeHtml(draft.serverName)}</strong></div><label>Адрес для друзей<input data-host-address value="${escapeHtml(detectedAddress)}"></label><small>Отправьте этот адрес друзьям после запуска.</small></section>` : '<label class="setup-address"><span>IP-адрес Host</span><input inputmode="decimal" autocomplete="off" placeholder="***.***.***.***"><span class="setup-port-suffix">:18483</span><span class="setup-address-hint" tabindex="0" data-tooltip="Введите IP-адрес из Radmin VPN владельца Host. Порт добавится автоматически.">?</span></label>'}${footer('К профилю', hostMode ? 'Создать Host' : 'Подключиться')}</div>`;
      const input = backdrop.querySelector('input'); input.focus();
      if (hostMode) input.readOnly = true;
      if (!hostMode) input.addEventListener('input', () => { input.value = input.value.replace(/:\d*$/, ''); });
      backdrop.querySelector('.setup-back').addEventListener('click', renderProfile);
      backdrop.querySelector('.setup-primary').addEventListener('click', () => { const raw = input.value.trim(); if (!raw) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; } start(hostMode ? (/\:\d+$/.test(raw) ? raw : `${raw}:18483`) : `${raw.replace(/:18483$/, '')}:18483`); });
    };
    document.body.classList.remove('boot-pending');
    renderWelcome();
  };
  window.radmincraft.loadSettings().then(settings => {
    if (!settings.onboardingCompleted) open(settings);
    else document.body.classList.remove('boot-pending');
  });
})();
