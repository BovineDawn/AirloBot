const { contextBridge, ipcRenderer } = require('electron');
const names = ['snapshot', 'status', 'startRuntime', 'settings', 'loadModel', 'unloadModel', 'newConversation', 'deleteConversation', 'send', 'stopChat', 'searchModels', 'modelFiles', 'startDownload', 'resumeDownload', 'pauseDownload', 'retryImport', 'openData', 'importModel'];
const api = Object.fromEntries(names.map(name => [name, arg => ipcRenderer.invoke('croc:call', name, arg)]));
api.subscribe = callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('croc:event', listener); return () => ipcRenderer.removeListener('croc:event', listener); };
contextBridge.exposeInMainWorld('croc', Object.freeze(api));
