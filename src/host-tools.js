// Host-only destructive actions, kept in their own "danger zone" at the very
// bottom of Settings so they are not brushed against while scrolling.
(() => {
  const pane = window.radmincraftSettings?.panes?.host || document.querySelector('.settings');
  if (!pane || !window.radmincraft?.clearLanMessages) return;

  const failover = document.createElement('section');
  failover.className = 'settings-section-card host-failover-setting';
  failover.innerHTML = `
    <div class="setting-copy">
      <strong>Сохранять связь при отключении Host</strong>
      <small>Разрешает RadminCraft автоматически выбрать временный Host среди подготовленных участников. Этот основной компьютер временным Host не становится. Minecraft, BlueMap и серверные инструменты останутся недоступны до его возвращения.</small>
    </div>`;
  const failoverToggle = document.createElement('input');
  failoverToggle.type = 'checkbox';
  failoverToggle.setAttribute('aria-label', 'Сохранять связь при отключении основного Host');
  failover.append(failoverToggle);
  pane.append(failover);
  window.radmincraft.loadSettings().then(settings => {
    failover.hidden = settings.mode !== 'host';
    failoverToggle.checked = settings.temporaryHostEnabled !== false;
  });
  failoverToggle.addEventListener('change', async () => {
    await window.radmincraft.saveSettings({ temporaryHostEnabled: failoverToggle.checked });
    window.radmincraftToast?.(failoverToggle.checked ? 'Резервирование связи включено' : 'Резервирование связи выключено');
  });

  const zone = document.createElement('div');
  zone.className = 'danger-zone';
  zone.hidden = true;
  zone.innerHTML = `
    <div class="danger-legend">Опасная зона · только Host</div>
    <div class="danger-row">
      <div class="setting-copy">
        <strong>Очистить общий чат</strong>
        <small>История удалится у всех участников без возможности восстановления.</small>
      </div>
      <button type="button" class="danger-button" data-clear-chat>Очистить чат</button>
    </div>
    <small class="danger-result" data-clear-result aria-live="polite" hidden></small>`;

  // Appended last, so it lands below the save button on the general tab.
  pane.append(zone);

  const button = zone.querySelector('[data-clear-chat]');
  const result = zone.querySelector('[data-clear-result]');

  const refresh = async () => {
    const settings = await window.radmincraft.loadSettings();
    zone.hidden = settings.mode !== 'host';
    failover.hidden = settings.mode !== 'host';
  };
  refresh();
  window.addEventListener('radmincraft:connection-changed', refresh);

  const say = (text, ok) => {
    result.hidden = false;
    result.textContent = text;
    result.classList.toggle('is-ok', Boolean(ok));
  };

  button.addEventListener('click', async () => {
    const confirmDanger = window.radmincraftConfirmDanger;
    const accepted = confirmDanger
      ? await confirmDanger({
          title: 'Очистить общий чат у всех?',
          text: 'Вся переписка сообщества будет удалена и у вас, и у каждого участника. Стикеры, ответы и сообщения из игры пропадут навсегда — восстановить их нельзя.',
          action: 'Очистить чат',
          finalTitle: 'Точно очистить весь чат?'
        })
      : window.confirm('Очистить общий чат у всех участников? Это нельзя отменить.');
    if (!accepted) return;

    button.disabled = true;
    try {
      const outcome = await window.radmincraft.clearLanMessages();
      if (outcome?.ok) {
        await window.radmincraft.saveMessages([]);
        say(`Чат очищен, удалено сообщений: ${outcome.removed ?? 0}.`, true);
        window.dispatchEvent(new CustomEvent('radmincraft:chat-cleared'));
      } else {
        say(outcome?.reason === 'not-host' ? 'Очистить чат может только Host.' : 'Не удалось очистить чат: нет связи с Host.');
      }
    } finally {
      button.disabled = false;
    }
  });
})();
