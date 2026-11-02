'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('projeeOutput', {
  emit: (ev) => ipcRenderer.send('out:event', ev),
  onCommand: (cb) => ipcRenderer.on('cmd', (_e, cmd) => cb(cmd)),
});
