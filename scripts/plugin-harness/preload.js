const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('harness', {
  getJob: () => ipcRenderer.invoke('harness:job'),
  report: (ev) => ipcRenderer.send('harness:event', ev),
  onCommand: (fn) => ipcRenderer.on('harness:cmd', (_e, cmd) => fn(cmd)),
});
