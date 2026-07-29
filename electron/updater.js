const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 48 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 12 * 1000;
const DEFER_INTERVAL_MS = 48 * 60 * 60 * 1000;

function publicState(state) {
  return {
    status: state.status,
    currentVersion: state.currentVersion,
    version: state.version,
    percent: state.percent,
    message: state.message,
    deferred: state.deferred
  };
}

function setupAutoUpdater({ app, ipcMain, getWindow, readSettings, writeSettings, log }) {
  const state = {
    status: app.isPackaged ? 'idle' : 'development',
    currentVersion: app.getVersion(),
    version: '',
    percent: 0,
    message: '',
    deferred: false
  };

  const emit = patch => {
    Object.assign(state, patch);
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('updates:state', publicState(state));
    return publicState(state);
  };

  const isDeferred = async version => {
    const settings = await readSettings();
    return settings.updateDeferredVersion === version
      && Number(settings.updateDeferredUntil || 0) > Date.now();
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => emit({
    status: 'checking', message: '', deferred: false
  }));
  autoUpdater.on('update-available', async info => {
    const version = String(info?.version || '');
    const deferred = await isDeferred(version);
    emit({
      status: deferred ? 'deferred' : 'available',
      version,
      percent: 0,
      message: '',
      deferred
    });
  });
  autoUpdater.on('update-not-available', () => emit({
    status: 'current', version: '', percent: 0, message: '', deferred: false
  }));
  autoUpdater.on('download-progress', progress => emit({
    status: 'downloading',
    percent: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0))),
    message: '',
    deferred: false
  }));
  autoUpdater.on('update-downloaded', info => emit({
    status: 'downloaded',
    version: String(info?.version || state.version || ''),
    percent: 100,
    message: '',
    deferred: false
  }));
  autoUpdater.on('error', error => {
    log?.('updater.error', {
      error: {
        message: error?.message || String(error || ''),
        stack: error?.stack || ''
      }
    });
    emit({
      status: 'error',
      message: 'Не удалось проверить обновления. Повторите позже.',
      percent: 0,
      deferred: false
    });
  });

  const check = async () => {
    if (!app.isPackaged) return emit({
      status: 'development',
      message: 'Проверка обновлений доступна в установленной версии.'
    });
    try {
      await autoUpdater.checkForUpdates();
      return publicState(state);
    } catch (error) {
      log?.('updater.check-failed', { error: { message: error?.message || String(error || '') } });
      return emit({
        status: 'error',
        message: 'Не удалось проверить обновления. Повторите позже.',
        percent: 0,
        deferred: false
      });
    }
  };

  ipcMain.handle('updates:get-state', () => publicState(state));
  ipcMain.handle('updates:check', check);
  ipcMain.handle('updates:download', async () => {
    if (state.status !== 'available') return publicState(state);
    emit({ status: 'downloading', percent: 0, message: '', deferred: false });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      log?.('updater.download-failed', { error: { message: error?.message || String(error || '') } });
      emit({
        status: 'error',
        message: 'Не удалось скачать обновление. Повторите позже.',
        percent: 0,
        deferred: false
      });
    }
    return publicState(state);
  });
  ipcMain.handle('updates:defer', async () => {
    if (!state.version) return publicState(state);
    await writeSettings({
      updateDeferredVersion: state.version,
      updateDeferredUntil: Date.now() + DEFER_INTERVAL_MS
    });
    return emit({ status: 'deferred', deferred: true });
  });
  ipcMain.handle('updates:install', () => {
    if (state.status !== 'downloaded') return false;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  if (app.isPackaged) {
    const startupTimer = setTimeout(check, STARTUP_DELAY_MS);
    startupTimer.unref?.();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    interval.unref?.();
  }

  return { check, getState: () => publicState(state) };
}

module.exports = { setupAutoUpdater };
