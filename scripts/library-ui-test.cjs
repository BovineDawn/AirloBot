// Real renderer, synthetic state only. No real hardware probe or Hub requests.
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'test-results/library-ui');
app.setPath('userData', path.join(out, 'profile')); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'airlo-library-test', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, state, status; const calls = [], errors = [], remote = [], GiB = 1024 ** 3;
const delay = ms => new Promise(r => setTimeout(r, ms));
const js = async source => { try { return await win.webContents.executeJavaScript(source); } catch (error) { console.error('Renderer check:', source, errors); throw error; } };
const emit = () => win.webContents.send('ui-event', { type: 'state', state });
async function click(text) { await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&b.getBoundingClientRect().width);if(!b)throw Error('Missing button: '+${JSON.stringify(text)});b.click()})()`); await delay(100); }
async function input(selector, value) { await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await delay(60); }
async function shot(name) { win.webContents.invalidate(); await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await delay(180); await fs.writeFile(path.join(out, name + '.png'), (await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()); }
const memory = { architecture: 'llama', context: 32768, layers: 32, embedding: 4096, heads: 32, kvHeads: 8 };
const hardware = () => ({ scannedAt: Date.now(), cpu: { name: 'Example desktop processor', threads: 16, architecture: 'x64' }, memory: { total: 32 * GiB, available: 24 * GiB }, disk: { available: 100 * GiB }, gpus: [{ name: 'Example graphics card', backend: 'Vulkan', total: 12 * GiB, available: 11 * GiB, shared: false }], gpuStatus: 'detected' });
const repo = { repo: 'Example/Local-Assistant-GGUF', revision: 'a'.repeat(40), license: 'Example license', downloads:12345, likes:120, lastModified:'2026-10-01T12:00:00.000Z', files: [
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
  if (method === 'searchModels') return [{id:repo.repo,downloads:12345,likes:120,lastModified:'2026-10-01T12:00:00.000Z',gated:false}];
  if (method === 'previewModel') { await delay(80); return { memory }; }
  if (method === 'startDownload') { assert.equal(arg.revision, repo.revision); state.downloads = [{ id: 'demo', repo: repo.repo, filename: arg.filename, status: 'paused', size: 3 * GiB, received: 0 }]; emit(); return 'demo'; }
  throw Error('Unexpected fixture operation: ' + method);
});
app.whenReady().then(async () => {
  await fs.mkdir(out, { recursive: true });
  const { DEFAULT_SETTINGS } = await import(require('node:url').pathToFileURL(path.join(root, 'electron/core.mjs')).href);
  state = { settings: { ...DEFAULT_SETTINGS, offline: false, contextTokens: 8192 }, workspace: { selected: 'new:chat', sidebarCollapsed: false, drafts: {} }, project: null, tasks: [], conversations: [], downloads: [], activeChat: null, activeTask: null, dataDir: 'Local fixture storage', hardwareProfile: null };
  status = { connected: false, models: [], loaded: [] };
  const methods = ['snapshot','status','settings','workspace','scanHardware','forgetHardware','modelFiles','previewModel','startDownload','searchModels'];
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
  assert.equal(await js('document.querySelectorAll(".settings-section:not([hidden])").length'),1);
  await js(`(()=>{const e=document.querySelector('[aria-label="Response token limit"]');e.value='8192';e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(80);
  await click('Models & hardware');
  await click('Responses');
  assert.equal(await js(`document.querySelector('[aria-label="Response token limit"]').value`),'8192');
  assert.equal(await js('Boolean(document.querySelector(".unsaved-dot"))'),true);
  await click('Models & hardware');
  assert.equal(await js('document.querySelector(".hardware-opt-in input").checked'), false);
  assert.equal(calls.filter(c=>c.method==='scanHardware').length,0);
  await js('document.querySelector(".hardware-opt-in input").click()'); await delay(100);
  assert.equal(state.settings.hardwareRecommendations,true); assert.equal(calls.filter(c=>c.method==='scanHardware').length,0);
  await click('Scan now'); assert.ok(state.hardwareProfile);
  await click('Forget results'); assert.equal(state.hardwareProfile,null);
  await click('Scan now');
  await click('Model library'); await click('Find models');
  await click('Browse popular models'); await delay(250);
  assert.match(await js('document.querySelector(".model-metrics").textContent'),/12,345 downloads \/ month/);
  assert.match(await js('document.querySelector(".model-metrics").textContent'),/120 likes/);
  assert.match(await js('document.querySelector(".model-metrics").textContent'),/2026/);
  assert.match(await js('document.querySelector(".model-metrics").textContent'),/per file/);
  await click('Compare memory fit'); await delay(250);
  assert.equal(await js('document.querySelector(".result-fit .fit-badge").textContent'),'Likely fits comfortably');
  await shot('search-dark');
  await input('[aria-label="Search Hugging Face models"]',repo.repo); await click('Search'); await delay(150);
  assert.equal(await js('document.querySelector(".variant-card.selected strong").textContent'),'Q4_K_M');
  assert.equal(await js('document.querySelector(".selected-download .fit-badge").textContent'),'Likely fits comfortably');
  assert.equal(await js('document.querySelector(".all-versions").open'),false);
  assert.match(await js('document.querySelector(".fit-suggestion").textContent'),/Suggested for memory fit/);
  win.setContentSize(1440,1120); await delay(100);
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
  win.setContentSize(1440,1000);
  await click('Settings');
  for (const theme of ['dark','light','glass']) {
    state.settings.theme = theme; emit(); await delay(80);
    for (const category of ['Responses','Project tasks','Models & hardware','Privacy & storage','Appearance']) {
      await click(category);
      assert.equal(await js('document.querySelectorAll(".settings-section:not([hidden])").length'),1);
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
    }
    await shot('settings-' + theme);
  }
  await click('Models & hardware'); await shot('settings-models-glass');
  win.setContentSize(1000,900); await delay(100); await shot('settings-narrow');
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
  assert.deepEqual(errors,[]); assert.deepEqual(remote,[]);
  console.log('PASS: search metrics/size/fit, visible guidance, version suggestion, opt-in/forget, revision-bound download, offline controls, category panels/draft preservation, three themes and narrow layout. No remote requests.');
}).then(()=>app.quit()).catch(error => { console.error(error.stack); app.exit(1); });
