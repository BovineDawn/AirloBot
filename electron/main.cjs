const { app, BrowserWindow, ipcMain, protocol, session, dialog, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
let win, service;
app.setName('AirloBot');
if (process.env.AIRLOBOT_DATA_DIR) app.setPath('userData', path.resolve(process.env.AIRLOBOT_DATA_DIR, 'electron-profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'airlobot', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const primaryInstance = app.requestSingleInstanceLock();
console.log('AirloBot starting', process.pid, 'primary:', primaryInstance);
if (!primaryInstance) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
if (primaryInstance) app.whenReady().then(async () => {
  const { AirloService } = await import('./core.mjs');
  const root = path.join(app.getAppPath(), 'dist');
  protocol.handle('airlobot', async request => {
    const url = new URL(request.url);
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (url.hostname !== 'app' || !filename.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    try { return new Response(await fs.readFile(filename), { headers: { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(airlobot:|devtools:)/.test(details.url) }));
  const dataDir = process.env.AIRLOBOT_DATA_DIR || path.join(app.getPath('userData'), 'data');
  service = new AirloService(dataDir, event => { if (win && !win.isDestroyed()) win.webContents.send('airlo:event', event); }, {
    runtimeDirectory: app.isPackaged ? path.join(process.resourcesPath, 'llama') : path.join(app.getAppPath(), 'native', 'llama'),
    legacyModelDir: path.join(os.homedir(), '.lmstudio', 'models')
  });
  await service.init();
  console.log('AirloBot local state ready');
  const methods = {
    snapshot: () => service.snapshot(), status: () => service.status(), startRuntime: () => service.startRuntime(),
    settings: arg => service.settings(arg), workspace: arg => service.workspace(arg), loadModel: arg => service.loadModel(arg), unloadModel: arg => service.unloadModel(arg),
    newConversation: () => service.newConversation(), deleteConversation: arg => service.deleteConversation(arg),
    send: arg => service.send(arg), stopChat: () => service.stopChat(), searchModels: arg => service.searchModels(arg),
    modelFiles: arg => service.modelFiles(arg), startDownload: arg => service.startDownload(arg),
    resumeDownload: arg => service.resumeDownload(arg), pauseDownload: arg => service.pauseDownload(arg), retryImport: arg => service.retryImport(arg),
    openData: () => shell.openPath(dataDir),
    chooseProject: async () => {
      const result = await dialog.showOpenDialog(win, { title: 'Choose an AirloBot project folder', properties: ['openDirectory'] });
      if (result.canceled) return null;
      return service.selectProject(result.filePaths[0]);
    },
    startTask: arg => service.startTask(arg), stopTask: arg => service.stopTask(arg), deleteTask: arg => service.deleteTask(arg), reviewChange: arg => service.reviewChange(arg),
    projectFiles: arg => service.projectFiles(arg), projectRead: arg => service.projectRead(arg),
    importModel: async () => {
      const result = await dialog.showOpenDialog(win, { title: 'Add a local GGUF model', properties: ['openFile'], filters: [{ name: 'GGUF models', extensions: ['gguf'] }] });
      if (result.canceled) return null;
      await service.registerModel(result.filePaths[0]);
      return service.status();
    }
  };
  ipcMain.handle('airlo:call', async (event, method, arg) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith('airlobot://app/')) throw new Error('Untrusted sender.');
    if (!Object.hasOwn(methods, method)) throw new Error('Unknown AirloBot operation.');
    return methods[method](arg);
  });
  win = new BrowserWindow({ width: 1320, height: 900, minWidth: 1000, minHeight: 680, title: 'AirloBot', icon: path.join(app.getAppPath(), 'assets', 'airlobot.png'), backgroundColor: '#141414', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => console.log('AirloBot window closed'));
  win.webContents.on('render-process-gone', (_event, details) => console.error('AirloBot renderer stopped', details));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('airlobot://app/')) event.preventDefault(); });
  await win.loadURL('airlobot://app/');
  win.hide();
  win.show();
  win.focus();
  console.log('AirloBot interface loaded');
}).catch(error => { dialog.showErrorBox('AirloBot could not start', String(error.stack || error)); app.quit(); });
let finishing = false, finished = false;
app.on('before-quit', event => {
  if (!service || finished) return;
  event.preventDefault();
  if (finishing) return;
  finishing = true;
  service.shutdown().catch(error => console.error('Could not finish saving local state:', error.message))
    .finally(() => { finished = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());
