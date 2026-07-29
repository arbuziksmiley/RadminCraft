// Host-only "connect your Minecraft server" flow.
//
// The Host can open this plain-language wizard from the notification centre or
// Host settings. Finishing it turns on "who's in game" and the in-game bridge.
(() => {
  if (!window.radmincraft) return;

  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  const bridgeVersions = ['1.12.2', '1.16.5', '1.18.2', '1.19.2', '1.20.1'];
  const state = { serverPath: '', serverMode: 'dedicated', hasLog: false, bridgeConnected: false, mapPort: 8100, mcVersion: '1.20.1 Forge', step: 0 };

  const refreshIntegrationState = async () => {
    const settings = await window.radmincraft.loadSettings();
    if (settings.mode !== 'host') return;
    const [diagnostics, bridge] = await Promise.all([
      window.radmincraft.diagnoseBridge?.() || Promise.resolve({}),
      window.radmincraft.getBridgeStatus?.() || Promise.resolve({})
    ]);
    const checks = [Boolean(diagnostics.logFound || bridge.connected)];
    if ((settings.serverMode || 'dedicated') === 'dedicated') checks.push(Boolean(diagnostics.bluemapOk));
    const configured = checks.every(Boolean);
    if (Boolean(settings.serverBridgeConfigured) !== configured) {
      await window.radmincraft.saveSettings({ serverBridgeConfigured: configured });
      window.dispatchEvent(new Event('radmincraft:connection-changed'));
    }
  };

  // ── Wizard ─────────────────────────────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.className = 'server-setup';
  backdrop.hidden = true;
  backdrop.innerHTML = '<section class="server-setup-card" role="dialog" aria-modal="true" aria-label="Подключение сервера Minecraft"></section>';
  document.body.append(backdrop);
  const card = backdrop.querySelector('.server-setup-card');

  const open = async () => {
    const [settings, bridge] = await Promise.all([
      window.radmincraft.loadSettings(),
      window.radmincraft.getBridgeStatus?.() || Promise.resolve({})
    ]);
    state.serverPath = settings.serverPath || '';
    state.serverMode = settings.serverMode || 'dedicated';
    state.hasLog = false;
    state.bridgeConnected = Boolean(bridge.connected);
    state.mapPort = Number(settings.mapPort) || 8100;
    state.mcVersion = settings.mcVersion || '1.20.1 Forge';
    state.step = 0;
    backdrop.hidden = false;
    renderStep();
  };
  const close = () => { backdrop.hidden = true; };
  window.radmincraftOpenServerSetup = open;

  const hostPane = window.radmincraftSettings?.panes?.host;
  if (hostPane) {
    const access = document.createElement('section');
    access.className = 'settings-section-card server-integration-setting';
    access.innerHTML = `
      <div class="setting-copy">
        <strong>Интеграция с Minecraft</strong>
        <small>Папка журнала, карта BlueMap и игровой ник. Мастер всегда можно открыть повторно.</small>
      </div>
      <button type="button">Открыть мастер</button>`;
    access.querySelector('button').addEventListener('click', open);
    hostPane.append(access);
  }

  const footer = (backLabel, nextLabel, nextAttrs = '') =>
    `<div class="ss-footer"><button type="button" class="ss-ghost" data-back>${backLabel}</button><button type="button" class="ss-primary" data-next ${nextAttrs}>${nextLabel}</button></div>`;

  const steps = [
    // 0 — intro
    () => `
      <div class="ss-hero">${svg('<path d="m9 4-6 2.5v13L9 17l6 3 6-2.5v-13L15 7 9 4Z"/><path d="M9 4v13M15 7v13"/>')}</div>
      <h1>Подключим ваш сервер Minecraft</h1>
      <p>Тогда друзья будут видеть, кто <b>зашёл в игру</b>, а сообщения из игрового чата появятся здесь, в общем чате. Это займёт минуту, и всё можно поменять позже.</p>
      <div class="ss-steps-dots"><i class="on"></i><i></i><i></i></div>
      ${footer('Позже', 'Начать')}`,
    // 1 — server folder
    () => `
      <span class="ss-eyebrow">Шаг 1 из 2</span>
      <h1>Как вы запускаете Minecraft?</h1>
      <p>Выберите подходящий вариант. Так RadminCraft поймёт, где искать игровой чат.</p>
      <div class="ss-mode-choice">
        <button type="button" data-server-mode="dedicated" class="${state.serverMode === 'dedicated' ? 'is-selected' : ''}">
          <span class="ss-choice-icon">${svg('<path d="M4 5h16v5H4zM4 14h16v5H4z"/><path d="M7 7.5h.01M7 16.5h.01"/>')}</span>
          <span class="ss-choice-copy"><strong>Отдельный сервер</strong><small>Запускается через server.jar или панель управления</small></span>
          <span class="ss-choice-state" aria-hidden="true">✓</span>
        </button>
        <button type="button" data-server-mode="lan" class="${state.serverMode === 'lan' ? 'is-selected' : ''}">
          <span class="ss-choice-icon">${svg('<path d="M4 18v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7"/><path d="M8 9V6h8v3M2 18h20"/>')}</span>
          <span class="ss-choice-copy"><strong>Мир открыт для сети</strong><small>Запускается кнопкой «Открыть для сети» в Minecraft</small></span>
          <span class="ss-choice-state" aria-hidden="true">✓</span>
        </button>
      </div>
      <label class="ss-field ss-version-field">
        <span>Версия Minecraft с Forge</span>
        <select data-minecraft-version>
          ${bridgeVersions.map(version => `<option value="${version} Forge" ${state.mcVersion.startsWith(version) ? 'selected' : ''}>${version} Forge</option>`).join('')}
          ${bridgeVersions.some(version => state.mcVersion.startsWith(version)) ? '' : `<option value="${escapeHtml(state.mcVersion)}" selected>${escapeHtml(state.mcVersion)} — без автоустановки мода</option>`}
        </select>
      </label>
      <div class="ss-folder-block">
        <span class="ss-folder-label">${state.serverMode === 'dedicated' ? 'Папка сервера' : 'Папка Minecraft'}</span>
        <button type="button" class="ss-pick" data-pick>${svg('<path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z"/>')}<span>${state.serverPath ? escapeHtml(shorten(state.serverPath)) : (state.serverMode === 'dedicated' ? 'Выбрать папку сервера' : 'Выбрать папку .minecraft')}</span></button>
      </div>
      <div class="ss-check ${(state.bridgeConnected || state.hasLog) ? 'is-ok' : 'is-warn'}" ${(state.serverPath || state.bridgeConnected) ? '' : 'hidden'}>${state.bridgeConnected ? '✓ Forge Bridge подключён — игровой чат работает напрямую, файл latest.log не требуется.' : state.hasLog ? '✓ Нашли журнал сервера — игровой чат работает через резервный режим.' : 'ℹ latest.log пока не найден. Это не ошибка, если установлен Forge Bridge; иначе журнал появится после первого запуска мира или сервера.'}</div>
      ${state.serverPath && !state.bridgeConnected ? '<div class="ss-bridge-install"><span><strong>Forge Bridge</strong><small>Рекомендуемый способ: корректный русский чат, привязка профилей и статусы игроков.</small></span><button type="button" class="ss-test" data-install-bridge>Установить мод</button></div>' : ''}
      <p class="ss-mode-help">${state.serverMode === 'dedicated' ? 'Crafty Controller и другие серверные панели относятся к «Отдельному серверу».' : 'Обычно папка .minecraft находится в профиле выбранного лаунчера.'}</p>
      ${footer('Назад', state.serverPath ? 'Дальше' : 'Настроить позже')}`,
    // 2 — bluemap
    () => `
      <span class="ss-eyebrow">Шаг 2 из 2</span>
      <h1>Есть карта мира (BlueMap)?</h1>
      <p>Если на сервере установлен <b>BlueMap</b>, друзья увидят игроков на карте. Обычно он работает на порту <b>8100</b>. Мод нужен только компьютеру Host.</p>
      <aside class="ss-version-help">
        <div><strong>Какую версию скачать?</strong><small>Выберите официальный файл, где одновременно совпадают ваша версия Minecraft, загрузчик Forge и требуемая версия Java.</small></div>
        <button type="button" data-bluemap-releases>Открыть версии BlueMap</button>
      </aside>
      <label class="ss-field"><span>Порт BlueMap</span><span class="ss-field-inline"><input data-port type="number" min="1" max="65535" value="${state.mapPort}"><button type="button" class="ss-test" data-test>Проверить</button></span></label>
      <div class="ss-check" data-test-result hidden></div>
      ${footer('Назад', 'Дальше')}`,
    // 3 — done
    () => `
      <div class="ss-hero is-done">${svg('<path d="M20 6 9 17l-5-5"/>')}</div>
      <h1>Готово!</h1>
      <p>RadminCraft связан с вашим сервером. Проверяем связь…</p>
      <div class="ss-summary" data-summary><span class="ss-summary-row">Проверяем…</span></div>
      <div class="ss-footer"><span></span><button type="button" class="ss-primary" data-close>Отлично</button></div>`
  ];

  function renderStep() {
    card.innerHTML = steps[state.step]();
    const back = card.querySelector('[data-back]');
    const next = card.querySelector('[data-next]');

    back?.addEventListener('click', () => {
      if (state.step === 0) { close(); return; }
      state.step -= 1; renderStep();
    });
    next?.addEventListener('click', () => advance());
    card.querySelector('[data-close]')?.addEventListener('click', close);
    card.querySelector('[data-pick]')?.addEventListener('click', pickFolder);
    card.querySelector('[data-test]')?.addEventListener('click', testBlueMap);
    card.querySelector('[data-bluemap-releases]')?.addEventListener('click', () => {
      window.radmincraft.openMods('https://github.com/BlueMap-Minecraft/BlueMap/releases');
    });
    card.querySelector('[data-install-bridge]')?.addEventListener('click', installBridge);
    card.querySelector('[data-minecraft-version]')?.addEventListener('change', event => {
      state.mcVersion = event.currentTarget.value;
    });
    card.querySelectorAll('[data-server-mode]').forEach(button => button.addEventListener('click', () => {
      if (state.serverMode === button.dataset.serverMode) return;
      state.serverMode = button.dataset.serverMode;
      state.serverPath = '';
      state.hasLog = false;
      renderStep();
    }));

    if (state.step === 3) runFinalCheck();
  }

  async function advance() {
    if (state.step === 2) {
      state.mapPort = clampPort(card.querySelector('[data-port]')?.value);
      // Save everything and mark the badge done.
      await window.radmincraft.saveSettings({
        serverPath: state.serverPath,
        serverMode: state.serverMode,
        mapPort: state.mapPort,
        mcVersion: state.mcVersion,
        serverBridgeConfigured: false
      });
      window.dispatchEvent(new Event('radmincraft:connection-changed'));
      refreshIntegrationState();
    }
    state.step = Math.min(steps.length - 1, state.step + 1);
    renderStep();
  }

  async function pickFolder() {
    const result = await window.radmincraft.chooseServerFolder?.();
    if (result?.ok) { state.serverPath = result.path; state.hasLog = Boolean(result.hasLog); renderStep(); }
  }

  async function testBlueMap() {
    const port = clampPort(card.querySelector('[data-port]')?.value);
    state.mapPort = port;
    const box = card.querySelector('[data-test-result]');
    box.hidden = false; box.className = 'ss-check'; box.textContent = 'Проверяем…';
    await window.radmincraft.saveSettings({ mapPort: port });
    const result = await window.radmincraft.diagnoseBridge?.();
    if (result?.bluemapOk) { box.classList.add('is-ok'); box.textContent = '✓ Карта BlueMap отвечает — игроки появятся на карте.'; }
    else { box.classList.add('is-warn'); box.textContent = '⚠ Карта не отвечает на этом порту. Это не страшно — можно продолжить без карты.'; }
  }

  async function installBridge(event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Устанавливаем…';
    await window.radmincraft.saveSettings({ serverPath: state.serverPath, serverMode: state.serverMode, mcVersion: state.mcVersion });
    const result = await window.radmincraft.installBridgeMod?.();
    if (result?.ok) {
      button.textContent = 'Установлено';
      window.radmincraftToast?.(`Forge Bridge ${result.version} установлен. Перезапустите Minecraft или сервер.`);
      return;
    }
    button.disabled = false;
    button.textContent = 'Установить мод';
    window.radmincraftToast?.(result?.reason === 'unsupported-version'
      ? `Для Minecraft ${result.version || 'этой версии'} готовой сборки пока нет.`
      : 'Не удалось скопировать мод. Проверьте папку и права доступа.');
  }

  async function runFinalCheck() {
    const box = card.querySelector('[data-summary]');
    const [result, bridge] = await Promise.all([
      window.radmincraft.diagnoseBridge?.() || Promise.resolve({}),
      window.radmincraft.getBridgeStatus?.() || Promise.resolve({})
    ]);
    const row = (ok, text) => `<span class="ss-summary-row ${ok ? 'is-ok' : 'is-off'}">${ok ? '✓' : '—'} ${text}</span>`;
    box.innerHTML =
      row(result.logFound || bridge.connected, bridge.connected ? 'Игровой чат подключён через Forge Bridge' : result.logFound ? 'Игровой чат подключён через журнал' : 'Игровой чат пока не подключён') +
      row(result.bluemapOk, result.bluemapOk ? 'Карта BlueMap подключена' : 'Карта BlueMap не подключена');
  }

  const clampPort = value => Math.max(1, Math.min(65535, Number(value) || 8100));
  const shorten = pathText => pathText.length > 46 ? '…' + pathText.slice(-45) : pathText;
  function escapeHtml(text) { const d = document.createElement('div'); d.textContent = String(text ?? ''); return d.innerHTML; }

  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !backdrop.hidden) close(); });
  window.addEventListener('radmincraft:connection-changed', refreshIntegrationState);
  refreshIntegrationState();
  window.setInterval(refreshIntegrationState, 15000);
})();
