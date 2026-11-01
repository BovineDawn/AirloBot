// Capture the unmodified production UI with fixed demo data only.
// Never read the user's data directory or connect to a model or remote service.
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const scratch = path.join(root, 'test-results/readme-capture');
const output = path.join(root, 'docs/media');
app.setPath('userData', path.join(scratch, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'airlo-demo', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const project = { name: 'Starter workspace', path: 'C:\\Fixture\\Starter' };
let win, state, status;
const failures = [], remoteRequests = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = source => win.webContents.executeJavaScript(source);
function changed() { win.webContents.send('demo-event', { type: 'state', state }); }
ipcMain.handle('demo-call', (_event, method, arg) => {
  if (method === 'snapshot') return state;
  if (method === 'status') return status;
  if (method === 'workspace') {
    if (arg.selected) state.workspace.selected = arg.selected;
    if (arg.draft) state.workspace.drafts[arg.draft.key] = arg.draft.text;
    return state.workspace;
  }
  if (method === 'settings') { Object.assign(state.settings, arg); changed(); return state; }
  throw Error('The documentation capture cannot perform this operation.');
});
async function click(label) {
  await js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing demo control');b.click();})()`);
  await delay(100);
}
async function capture(name) {
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await delay(180);
  assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false);
  await fs.writeFile(path.join(output, name), (await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async () => {
  await fs.mkdir(scratch, { recursive: true }); await fs.mkdir(output, { recursive: true });
  const { DEFAULT_SETTINGS } = await import(require('node:url').pathToFileURL(path.join(root, 'electron/core.mjs')).href);
  const task = {
    id: 'demo-review', goal: 'Review the welcome message and propose a clearer next step.', project,
    model: 'demo-gemma', status: 'awaiting_review', turns: 9, steps: 18,
    budget: { maxTurns: 100, maxMinutes: 60 }, updatedAt: '2026-11-01T12:00:00Z',
    result: 'I reviewed the welcome screen with a reviewer helper. The message tells people to open the app, even though they are already in it.\n\n### A clearer first step\n\nReplace **“Open the app”** with **“Choose a project to begin.”** The new copy points directly to the next action.\n\nThe change is ready in `welcome.txt`. Review the before and after, then apply it when you’re ready.',
    agents: [
      { id: 'demo-main', name: 'AirloBot', role: 'primary', goal: 'Review the welcome message', status: 'completed' },
      { id: 'demo-helper', name: 'Reviewer', role: 'reviewer', goal: 'Check the next step shown on the welcome screen', status: 'completed', result: 'The welcome message should point to the project picker. No other changes are needed.' },
    ],
    events: [{ id: 'demo-event', agent: 'Reviewer', type: 'completed', at: '2026-11-01T12:00:00Z', detail: 'Reviewed welcome.txt and returned a focused suggestion.' }],
    filesRead: { 'welcome.txt': { startLine: 1, totalLines: 2 } },
    proposals: [{ id: 'demo-proposal', path: 'welcome.txt', status: 'pending', reason: 'Help people find their next action.', before: 'Welcome to your workspace\nOpen the app\n', after: 'Welcome to your workspace\nChoose a project to begin\n' }],
  };
  state = {
    settings: { ...DEFAULT_SETTINGS, model: 'demo-gemma', theme: 'glass', reducedMotion: true },
    workspace: { selected: 'task:demo-review', sidebarCollapsed: false, drafts: {} },
    project, activeTask: null, activeChat: null, reviewing: false, endpoint: 'Bundled llama.cpp · local only',
    dataDir: 'Demo storage', downloads: [], tasks: [task],
    conversations: [{ id: 'demo-chat', title: 'Plan a personal notes app', updatedAt: '2026-11-01T10:00:00Z', messages: [
      { id: 'demo-question', role: 'user', content: 'Help me plan a simple notes app.', status: 'complete' },
      { id: 'demo-answer', role: 'assistant', content: 'Start with a folder for notes, a quick search, and a clean editing view. Keep the first version small enough to use every day.', status: 'complete' },
    ] }],
  };
  const model = { key: 'demo-gemma', display_name: 'Gemma 4 E4B', publisher: 'Local library', params_string: '7.5B', quantization: { name: 'Q4_K_M' }, size_bytes: 5340000000, max_context_length: 8192, loaded_instances: [{ id: 'demo-loaded' }] };
  status = { connected: true, models: [model, { key: 'demo-small', display_name: 'Example compact model', publisher: 'Local library', params_string: '3B', quantization: { name: 'Q4_K_M' }, size_bytes: 2100000000, max_context_length: 8192, loaded_instances: [] }], loaded: [model] };
  await fs.writeFile(path.join(scratch, 'preload.cjs'), `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('airlo',{...Object.fromEntries(['snapshot','status','workspace','settings'].map(m=>[m,arg=>ipcRenderer.invoke('demo-call',m,arg)])),subscribe:fn=>{const listener=(_e,v)=>fn(v);ipcRenderer.on('demo-event',listener);return()=>ipcRenderer.removeListener('demo-event',listener);}});`);
  protocol.handle('airlo-demo', async request => {
    const url = new URL(request.url), base = path.join(root, 'dist');
    const filename = path.resolve(base, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (url.hostname !== 'app' || !filename.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
    return new Response(await fs.readFile(filename), { headers: { 'Content-Type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' }[path.extname(filename)] || 'application/octet-stream' } });
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const local = details.url.startsWith('airlo-demo:'); if (!local) remoteRequests.push(details.url); callback({ cancel: !local });
  });
  win = new BrowserWindow({ useContentSize: true, width: 1440, height: 900, show: false, webPreferences: { preload: path.join(scratch, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') failures.push(event.message); });
  await win.loadURL('airlo-demo://app/');
  for (let n = 0; n < 50; n++) { if (await js('Boolean(document.querySelector(".composer"))')) break; await delay(100); }
  await capture('workspace-glass.png');
  state.settings.theme = 'dark'; changed(); await delay(100); await click('Review 1 change');
  await capture('review-dark.png');
  await click('Model library'); state.settings.theme = 'light'; changed(); await delay(100);
  await capture('library-light.png');
  await click('Settings'); state.settings.theme = 'glass'; changed(); await delay(100);
  await click('Appearance');
  win.setContentSize(1440, 760); await delay(100);
  await js('document.querySelector(".appearance").scrollIntoView()');
  await capture('appearance-glass.png');
  assert.deepEqual(remoteRequests, []); assert.deepEqual(failures, []);
  console.log('Captured four production UI screenshots with synthetic content only. No model or network requests.');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
