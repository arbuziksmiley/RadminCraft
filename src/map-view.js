(() => {
  const map = document.querySelector('.map');
  if (!map || !window.radmincraft?.getMapInfo) return;
  map.innerHTML = `
    <iframe class="journeymap-frame" title="BlueMap — карта мира" allow="fullscreen" hidden></iframe>
    <section class="map-empty" aria-live="polite">
      <span class="map-empty-icon" aria-hidden="true">⌖</span>
      <h2>Подключаем BlueMap</h2>
      <p>Проверяем веб-карту на компьютере Host…</p>
      <div class="map-host-settings" hidden>
        <label>Порт BlueMap<input data-map-port type="number" min="1" max="65535" value="8100"></label>
        <label>Свой адрес, если нужен<input data-map-url placeholder="Например, http://26.79.127.176:8100/"></label>
        <button data-map-save type="button">Сохранить и проверить</button>
      </div>
      <div class="map-empty-actions"><button data-map-retry type="button">Проверить снова</button><button data-map-help type="button">Открыть в браузере</button></div>
      <small class="map-instruction"></small>
    </section>
    <div class="map-overlay" hidden>
      <div><strong>BlueMap</strong><small data-map-address></small></div>
      <button data-map-fullscreen type="button">На весь экран</button>
      <button data-map-disconnect type="button">Отключить карту</button>
      <button data-map-reload type="button" title="Перезагрузить карту" aria-label="Перезагрузить карту">↻</button>
      <button data-map-external type="button">Открыть отдельно</button>
    </div>
    <aside class="map-players" hidden><strong>Игроки на карте</strong><div></div></aside>`;

  const frame = map.querySelector('.journeymap-frame');
  const empty = map.querySelector('.map-empty');
  const title = empty.querySelector('h2');
  const description = empty.querySelector('p');
  const instruction = map.querySelector('.map-instruction');
  const settingsBox = map.querySelector('.map-host-settings');
  const portInput = map.querySelector('[data-map-port]');
  const urlInput = map.querySelector('[data-map-url]');
  const overlay = map.querySelector('.map-overlay');
  const playersBox = map.querySelector('.map-players');
  const saveButton = map.querySelector('[data-map-save]');
  let currentInfo;
  let loadedUrl = '';
  let manuallyDisconnected = false;

  const showUnavailable = info => {
    frame.hidden = true; overlay.hidden = true; empty.hidden = false;
    title.textContent = info?.mode === 'host' ? 'BlueMap пока недоступна' : 'Карта Host пока недоступна';
    description.textContent = info?.mode === 'host'
      ? `RadminCraft не нашёл BlueMap по адресу ${info.url || `http://127.0.0.1:${info.port || 8100}/`}.`
      : 'Компьютер Host отвечает, но его веб-карта BlueMap не открывается.';
    instruction.textContent = info?.mode === 'host'
      ? 'Установите BlueMap только в папку mods выделенного Forge-сервера, примите загрузку ресурсов в core.conf и перезапустите сервер. Игрокам этот мод не нужен.'
      : 'Попросите Host установить и запустить BlueMap на сервере. Стандартный адрес карты использует TCP-порт 8100.';
    settingsBox.hidden = info?.mode !== 'host';
    portInput.value = String(info?.port || 8100);
    urlInput.value = info?.customUrl || '';
  };

  const showMap = info => {
    if (manuallyDisconnected) return;
    empty.hidden = true; frame.hidden = false; overlay.hidden = false;
    overlay.querySelector('[data-map-address]').textContent = info.url;
    if (loadedUrl !== info.url) { loadedUrl = info.url; frame.src = info.url; }
  };

  const renderPlayers = async () => {
    const bridge = await window.radmincraft.getBridgeStatus?.();
    const players = bridge?.connected && Array.isArray(bridge.mapPlayers) ? bridge.mapPlayers : [];
    playersBox.hidden = !players.length;
    playersBox.querySelector('div').replaceChildren(...players.slice(0, 30).map(player => {
      const item = document.createElement('span');
      const name = document.createElement('b'); name.textContent = player.name;
      const location = document.createElement('small'); location.textContent = `${Math.round(player.x)}, ${Math.round(player.z)}`;
      item.append(name, location); return item;
    }));
  };

  const refresh = async () => {
    title.textContent = 'Подключаем BlueMap'; description.textContent = 'Проверяем веб-карту на компьютере Host…';
    currentInfo = await window.radmincraft.getMapInfo();
    if (currentInfo?.ok && currentInfo.reachable) showMap(currentInfo); else showUnavailable(currentInfo || {});
    await renderPlayers();
  };

  [portInput, urlInput].forEach(input => input.addEventListener('input', () => window.radmincraftMarkDirty?.(saveButton)));
  saveButton.disabled = true;
  saveButton.addEventListener('click', async () => {
    const mapPort = Math.max(1, Math.min(65535, Number(portInput.value) || 8100));
    const mapUrl = urlInput.value.trim();
    await window.radmincraft.saveSettings({ mapPort, mapUrl }); loadedUrl = ''; await refresh(); window.radmincraftMarkSaved?.(saveButton);
  });
  map.querySelector('[data-map-retry]').addEventListener('click', () => { manuallyDisconnected = false; refresh(); });
  map.querySelector('[data-map-help]').addEventListener('click', () => { if (currentInfo?.url) window.radmincraft.openMapExternal(currentInfo.url); });
  map.querySelector('[data-map-external]').addEventListener('click', () => { if (currentInfo?.url) window.radmincraft.openMapExternal(currentInfo.url); });
  map.querySelector('[data-map-reload]').addEventListener('click', () => { if (loadedUrl) frame.src = loadedUrl; else refresh(); });
  map.querySelector('[data-map-disconnect]').addEventListener('click', () => {
    manuallyDisconnected = true; loadedUrl = ''; frame.src = 'about:blank';
    showUnavailable({ ...currentInfo, mode: currentInfo?.mode });
    title.textContent = 'Карта отключена';
    description.textContent = 'BlueMap выгружена из памяти. Нажмите «Проверить снова», чтобы подключить карту.';
  });
  map.querySelector('[data-map-fullscreen]').addEventListener('click', async () => {
    try { if (!document.fullscreenElement) await map.requestFullscreen(); else await document.exitFullscreen(); } catch {}
  });
  frame.addEventListener('error', () => showUnavailable(currentInfo || {}));
  refresh(); window.setInterval(renderPlayers, 5000);
})();
