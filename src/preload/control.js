'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = ['out:event', 'output:status', 'displays:changed', 'app:closeRequest', 'project:openRequest', 'project:exportProgress'];

contextBridge.exposeInMainWorld('projee', {
  mediaUrl: (p) => 'projee-media://local/' + encodeURIComponent(p),
  // webUtils n'existe pas dans Electron 26 (édition macOS ancien) : la page lit alors file.path.
  pathForFile: (file) => (webUtils ? webUtils.getPathForFile(file) : null),
  sendOutput: (cmd) => ipcRenderer.send('out:cmd', cmd),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    if (!EVENTS.includes(channel)) throw new Error(`Événement inconnu : ${channel}`);
    ipcRenderer.on(channel, (_e, ...args) => cb(...args));
  },
});
