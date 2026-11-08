const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('frame', {
  getState: () => ipcRenderer.invoke('frame:state'),
  pickFiles: () => ipcRenderer.invoke('frame:pick'),
  addDroppedFiles: files => ipcRenderer.invoke('frame:add', Array.from(files, file => webUtils.getPathForFile(file))),
  pickDirectory: () => ipcRenderer.invoke('frame:directory'),
  start: options => ipcRenderer.invoke('frame:start', options),
  cancel: () => ipcRenderer.invoke('frame:cancel'),
  remove: id => ipcRenderer.invoke('frame:remove', id),
  clear: () => ipcRenderer.invoke('frame:clear'),
  retry: id => ipcRenderer.invoke('frame:retry', id),
  reveal: id => ipcRenderer.invoke('frame:reveal', id),
  openDirectory: () => ipcRenderer.invoke('frame:open-directory'),
  removeHistory: id => ipcRenderer.invoke('frame:remove-history', id),
  clearHistory: () => ipcRenderer.invoke('frame:clear-history'),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('frame:updated', listener); return () => ipcRenderer.removeListener('frame:updated', listener); }
});
