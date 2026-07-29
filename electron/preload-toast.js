const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the notification overlay window only. Deliberately tiny: the
// overlay must not be able to reach the rest of the application.
contextBridge.exposeInMainWorld('radmincraftToast', {
  onAdd: callback => ipcRenderer.on('toast:add', (_, toast) => callback(toast)),
  reportHeight: height => ipcRenderer.send('toast:layout', height),
  reportEmpty: () => ipcRenderer.send('toast:empty'),
  open: page => ipcRenderer.send('toast:open', page)
});
