// Connection diagnostics, rendered as a section inside Settings rather than a
// top-level tab: it is a rarely-used troubleshooting tool, not daily navigation.
(() => {
  const pane = window.radmincraftSettings?.panes?.connection || document.querySelector('.settings');
  if (!pane || !window.radmincraft?.runNetworkDiagnostics) return;

  const reserve = document.createElement('div');
  reserve.className = 'setting-item-clean reserve-host-setting';
  reserve.hidden = true;
  reserve.innerHTML = `
    <div class="setting-copy">
      <strong data-reserve-title>Этот компьютер может стать временным Host</strong>
      <small data-reserve-copy>Если основной Host выключится, компьютер сможет сохранить общий чат и голосовую связь. При первом включении Windows попросит разрешить входящие подключения.</small>
    </div>`;
  const reserveToggle = document.createElement('input');
  reserveToggle.type = 'checkbox';
  reserveToggle.setAttribute('aria-label', 'Разрешить этому компьютеру становиться временным Host');
  reserve.append(reserveToggle);
  pane.append(reserve);
  const refreshReserve = async () => {
    const [settings, status] = await Promise.all([
      window.radmincraft.loadSettings(),
      window.radmincraft.getLanStatus?.()
    ]);
    reserve.hidden = settings.mode === 'host';
    const isTemporaryHost = status?.ok && status?.hostRole === 'temporary' && status?.mode === 'temporary-host';
    reserve.querySelector('[data-reserve-title]').textContent = isTemporaryHost
      ? 'Этот компьютер сейчас поддерживает связь'
      : 'Этот компьютер может стать временным Host';
    reserve.querySelector('[data-reserve-copy]').textContent = isTemporaryHost
      ? 'Основной Host недоступен. Чат и голосовая связь временно работают через этот компьютер; настройки владельца и Minecraft-сервера сюда не переносятся.'
      : 'Если основной Host выключится, компьютер сможет сохранить общий чат и голосовую связь. При первом включении Windows попросит разрешить входящие подключения.';
    reserveToggle.hidden = isTemporaryHost;
    reserveToggle.checked = settings.temporaryHostEligible !== false && settings.temporaryHostPrepared === true;
  };
  reserveToggle.addEventListener('change', async () => {
    reserveToggle.disabled = true;
    if (!reserveToggle.checked) {
      await window.radmincraft.saveSettings({ temporaryHostEligible: false });
      window.radmincraftToast?.('Этот компьютер исключён из резервных');
    } else {
      const result = await window.radmincraft.ensureFirewallAccess();
      await window.radmincraft.saveSettings({
        temporaryHostEligible: Boolean(result?.ok),
        temporaryHostPrepared: Boolean(result?.ok),
        temporaryHostPreparationAttempted: true
      });
      if (result?.ok) window.radmincraftToast?.('Компьютер готов стать временным Host');
      else window.radmincraftToast?.('Windows не разрешила входящие подключения');
    }
    reserveToggle.disabled = false;
    await refreshReserve();
  });
  refreshReserve();
  window.addEventListener('radmincraft:connection-changed', refreshReserve);

  const section = document.createElement('div');
  section.className = 'diag-section';
  section.innerHTML = `
    <div class="diag-head">
      <div class="setting-copy">
        <strong>Диагностика подключения</strong>
        <small class="diag-sub" data-diag-sub>Проверяет сеть Radmin VPN и связь с Host по шагам.</small>
      </div>
      <div class="diag-primary-actions">
        <button data-diag-logs type="button" class="diag-ghost">Открыть папку логов</button>
        <button data-diag-run type="button" class="diag-run">Проверить</button>
      </div>
    </div>
    <strong class="diag-verdict" data-diag-verdict hidden></strong>
    <div class="diag-steps" data-diag-steps></div>
    <div class="diag-actions">
      <small class="diag-time" data-diag-time></small>
    </div>`;

  pane.append(section);
  const setupTools = pane.querySelector('.settings-more');
  if (setupTools) pane.append(setupTools);

  const verdict = section.querySelector('[data-diag-verdict]');
  const sub = section.querySelector('[data-diag-sub]');
  const stepsBox = section.querySelector('[data-diag-steps]');
  const runButton = section.querySelector('[data-diag-run]');
  const logsButton = section.querySelector('[data-diag-logs]');
  const timeLabel = section.querySelector('[data-diag-time]');

  const icons = { ok: '✓', fail: '✕', warn: '!', skip: '—' };

  const setVerdict = (state, title, detail) => {
    verdict.hidden = false;
    verdict.dataset.state = state;
    verdict.textContent = title;
    sub.textContent = detail;
  };

  const renderSteps = steps => {
    stepsBox.replaceChildren(...steps.map(step => {
      const row = document.createElement('div');
      row.className = 'diag-step';
      row.dataset.status = step.status;

      const icon = document.createElement('span');
      icon.className = 'diag-step-icon';
      icon.textContent = icons[step.status] || '·';

      const body = document.createElement('div');
      body.className = 'diag-step-body';
      const label = document.createElement('span');
      label.className = 'diag-step-label';
      label.textContent = step.label;
      const detail = document.createElement('span');
      detail.className = 'diag-step-detail';
      detail.textContent = step.detail || '';
      body.append(label, detail);
      if (step.hint) {
        const hint = document.createElement('span');
        hint.className = 'diag-step-hint';
        hint.textContent = step.hint;
        body.append(hint);
      }

      row.append(icon, body);
      return row;
    }));
  };

  const verdictText = result => {
    if (result.ok) return ['ok', 'Соединение в порядке', result.mode === 'host' ? 'Host готов принимать участников.' : 'Host доступен, чат и голос должны работать.'];
    const first = result.steps.find(step => step.status === 'fail');
    const map = {
      adapter: ['fail', 'Нет сети Radmin VPN', 'Приложение не нашло адрес 26.x.x.x. Без неё связь невозможна.'],
      'host-address': ['fail', 'Адрес Host не задан', 'Укажите адрес компьютера Host в мастере настройки.'],
      peer: ['fail', 'Host не виден в Radmin VPN', 'Проблема на уровне VPN, а не RadminCraft. Пока ping не проходит, чат не заработает.'],
      tcp: ['fail', 'Порт Host закрыт', 'Host виден в сети, но приложение или порт недоступны.'],
      http: ['fail', 'Host отвечает неправильно', 'Порт открыт, но приложение Host не отдаёт данные.'],
      port: ['fail', 'Локальный порт занят', 'Другая программа держит порт 18483.']
    };
    return first ? (map[first.id] || ['fail', 'Соединение недоступно', first.hint || '']) : ['warn', 'Есть предупреждения', 'Основная связь работает, но проверьте отмеченные пункты.'];
  };

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    runButton.disabled = true;
    setVerdict('running', 'Проверяем соединение…', 'Тестируем сеть Radmin VPN и связь с Host.');
    stepsBox.replaceChildren();
    try {
      const result = await window.radmincraft.runNetworkDiagnostics();
      renderSteps(result.steps || []);
      setVerdict(...verdictText(result));
      const stamp = new Date(result.time || Date.now());
      timeLabel.textContent = `Проверено в ${stamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } catch {
      setVerdict('fail', 'Не удалось выполнить проверку', 'Внутренняя ошибка диагностики. Загляните в логи.');
    } finally {
      running = false;
      runButton.disabled = false;
    }
  };

  runButton.addEventListener('click', run);
  logsButton.addEventListener('click', () => window.radmincraft.openDiagnosticsFolder?.());
})();
