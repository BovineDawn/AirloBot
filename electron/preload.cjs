const { contextBridge, ipcRenderer } = require('electron');
const names = ['snapshot', 'status', 'startRuntime', 'settings', 'workspace', 'loadModel', 'unloadModel', 'newConversation', 'deleteConversation', 'send', 'stopChat', 'searchModels', 'modelFiles', 'startDownload', 'resumeDownload', 'pauseDownload', 'retryImport', 'openData', 'importModel', 'chooseProject', 'startTask', 'stopTask', 'deleteTask', 'reviewChange', 'projectFiles', 'projectRead', 'scanHardware', 'forgetHardware', 'previewModel', 'inspectLocalModel'];
const api = Object.fromEntries(names.map(name => [name, arg => ipcRenderer.invoke('airlo:call', name, arg)]));
api.subscribe = callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('airlo:event', listener); return () => ipcRenderer.removeListener('airlo:event', listener); };
contextBridge.exposeInMainWorld('airlo', Object.freeze(api));
