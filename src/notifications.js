// Notification dispatch.
//
// Every notification is drawn by RadminCraft itself, in a frameless overlay
// window that floats above other applications (see electron/main.js and
// src/toast.js). There is deliberately no second in-app code path: one renderer
// means the toasts look identical whether the app is focused, minimised, or
// hidden in the tray.
(() => {
  if (!window.radmincraft) return;

  window.radmincraftNotify = async ({ kind, title, body, page, setting }) => {
    const settings = await window.radmincraft.loadSettings();
    if (!settings.notificationsEnabled) return;
    if (setting && settings[setting] === false) return;
    await window.radmincraft.showNotification?.({ kind, title, body, page });
  };

  // Clicking a toast asks the main process to focus the window and open the
  // relevant tab.
  window.radmincraft.onNavigatePage?.(page => {
    document.querySelector(`.nav[data-page="${page}"]`)?.click();
  });
})();
