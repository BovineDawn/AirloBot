// Real renderer, synthetic state only. No real hardware probe or Hub requests.
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'test-results/library-ui');
app.setPath('userData', path.join(out, 'profile')); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'airlo-library-test', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, state, status; const calls = [], errors = [], remote = [], GiB = 1024 ** 3;
const delay = ms => new Promise(r => setTimeout(r, ms));
const js = source => win.webContents.executeJavaScript(source);
const emit = () => win.webContents.send('ui-event', { type: 'state', state });
async function click(text) { await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&b.getBoundingClientRect().width);if(!b)throw Error('Missing button: '+${JSON.stringify(text)});b.click()})()`); await delay(100); }
async function input(selector, value) { await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await delay(60); }
async function shot(name) { await delay(160); await fs.writeFile(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
const memory = { architecture: 'llama', context: 32768, layers: 32, embedding: 4096, heads: 32, kvHeads: 8 };
const hardware = () => ({ scannedAt: Date.now(), cpu: { name: 'Example desktop processor', threads: 16, architecture: 'x64' }, memory: { total: 32 * GiB, available: 24 * GiB }, disk: { available: 100 * GiB }, gpus: [{ name: 'Example graphics card', backend: 'Vulkan', total: 12 * GiB, available: 11 * GiB, shared: false }], gpuStatus: 'detected' });
const repo = { repo: 'Example/Local-Assistant-GGUF', revision: 'a'.repeat(40), license: 'Example license', files: [
  { name: 'local-assistant-Q3_K_M.gguf', size: 3 * GiB, sha256: 'b'.repeat(64) },
  { name: 'local-assistant-Q4_K_M.gguf', size: 4 * GiB, sha256: 'c'.repeat(64) },
  { name: 'local-assistant-Q5_K_M.gguf', size: 5 * GiB, sha256: 'd'.repeat(64) },
  { name: 'mmproj-F16.gguf', size: GiB, projector: true, sha256: 'e'.repeat(64) },
] };
ipcMain.handle('library-fixture', async (_e, method, arg) => {
  calls.push({ method, arg });
  if (method === 'snapshot') return state;
  if (method === 'status') return status;
  if (method === 'settings') { Object.assign(state.settings, arg); if (!state.settings.hardwareRecommendations) state.hardwareProfile = null; emit(); return state; }
  if (method === 'workspace') return state.workspace;
  if (method === 'scanHardware') { state.hardwareProfile = hardware(); emit(); return state; }
  if (method === 'forgetHardware') { state.hardwareProfile = null; emit(); return state; }
  if (method === 'modelFiles') return repo;
  if (method === 'previewModel') { await delay(80); return { memory }; }
  if (method === 'startDownload') { assert.equal(arg.revision, repo.revision); state.downloads = [{ id: 'demo', repo: repo.repo, filename: arg.filename, status: 'paused', size: 3 * GiB, received: 0 }]; emit(); return 'demo'; }
  throw Error('Unexpected fixture operation: ' + method);
});
app.whenReady().then(async () => {
  await fs.mkdir(out, { recursive: true });
  const { DEFAULT_SETTINGS } = await import(require('node:url').pathToFileURL(path.join(root, 'electron/core.mjs')).href);
  state = { settings: { ...DEFAULT_SETTINGS, offline: false, contextTokens: 8192 }, workspace: { selected: 'new:chat', sidebarCollapsed: false, drafts: {} }, project: null, tasks: [], conversations: [], downloads: [], activeChat: null, activeTask: null, dataDir: 'Local fixture storage', hardwareProfile: null };
  status = { connected: false, models: [], loaded: [] };
  const methods = ['snapshot','status','settings','workspace','scanHardware','forgetHardware','modelFiles','previewModel','startDownload'];
  await fs.writeFile(path.join(out,'preload.cjs'), `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('airlo',{...Object.fromEntries(${JSON.stringify(methods)}.map(m=>[m,arg=>ipcRenderer.invoke('library-fixture',m,arg)])),subscribe:fn=>{const f=(_e,v)=>fn(v);ipcRenderer.on('ui-event',f);return()=>ipcRenderer.removeListener('ui-event',f)}});`);
  protocol.handle('airlo-library-test', async request => {
    const url = new URL(request.url), base = path.join(root,'dist'), file = path.resolve(base,'.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (url.hostname !== 'app' || !file.startsWith(base + path.sep)) return new Response('Forbidden', {status:403});
    return new Response(await fs.readFile(file), { headers: { 'Content-Type': {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)] || 'application/octet-stream' } });
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const allowed = details.url.startsWith('airlo-library-test:'); if (!allowed) remote.push(details.url); callback({cancel:!allowed}); });
  win = new BrowserWindow({ useContentSize:true, width:1440, height:1000, show:false, webPreferences:{preload:path.join(out,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false} });
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  await win.loadURL('airlo-library-test://app/'); await delay(250);
  await click('Settings');
  assert.equal(await js('document.querySelector(".hardware-opt-in input").checked'), false);
  assert.equal(calls.filter(c=>c.method==='scanHardware').length,0);
  await js('document.querySelector(".hardware-opt-in input").click()'); await delay(100);
  assert.equal(state.settings.hardwareRecommendations,true); assert.equal(calls.filter(c=>c.method==='scanHardware').length,0);
  await click('Scan now'); assert.ok(state.hardwareProfile);
  await click('Forget results'); assert.equal(state.hardwareProfile,null);
  await click('Scan now');
  await click('Model library'); await click('Find models');
  await input('[aria-label="Search Hugging Face models"]',repo.repo); await click('Search'); await delay(150);
  assert.equal(await js('document.querySelector(".variant-card.selected strong").textContent'),'Q4_K_M');
  assert.equal(await js('document.querySelector(".selected-download .fit-badge").textContent'),'Likely fits comfortably');
  assert.equal(await js('document.querySelector(".all-versions").open'),false);
  for (const theme of ['dark','light','glass']) {
    state.settings.theme = theme; emit(); await delay(100);
    await shot('chooser-' + theme);
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
  }
  win.setSize(1000,900); await delay(100); await shot('chooser-narrow');
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
  await js('document.querySelectorAll(".variant-card")[1].click()'); await delay(200);
  assert.match(await js('document.querySelector(".selected-download h3").textContent'),/Q3_K_M/);
  await js('document.querySelector(".all-versions").open=true');
  assert.equal(await js('[...document.querySelectorAll(".version-option")].find(x=>x.textContent.includes("mmproj")).querySelector("input").disabled'),true);
  await click('Download selected'); assert.match(calls.find(c=>c.method==='startDownload').arg.filename,/Q3_K_M/);
  assert.equal(await js('Boolean(document.querySelector(".download-row"))'),true);
  await click('Find models'); await delay(160);
  state.hardwareProfile = { ...hardware(), scannedAt: Date.now() - 20 * 60 * 1000 }; emit(); await delay(80);
  assert.equal(await js('document.querySelector(".selected-download .fit-badge").textContent'),'Refresh scan');
  state.settings.offline = true; emit(); await delay(80);
  assert.equal(await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Download selected").disabled'),true);
  state.hardwareProfile = hardware(); state.settings.hardwareRecommendations = false; emit(); await delay(80);
  assert.equal(await js('document.querySelector(".selected-download .fit-badge").textContent'),'Hardware check off');
  assert.deepEqual(errors,[]); assert.deepEqual(remote,[]);
  console.log('PASS: opt-in/forget flow, version choice, compatibility states, revision-bound download, offline controls, three themes and narrow layout. No remote requests.');
}).catch(error => { console.error(error.stack); process.exitCode=1; }).finally(()=>app.quit());
