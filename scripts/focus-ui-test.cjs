// Production-renderer regression checks. Run after npm run build with Electron.
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results/focus-ui');
app.setPath('userData', path.join(out, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'airlobot-test', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, state, status, failSend = false;
const calls = [], errors = [], report = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = async source => { try { return await win.webContents.executeJavaScript(source); } catch (e) { console.error('Renderer check failed:', source); throw e; } };
async function click(text) { await js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)} && b.getBoundingClientRect().width);if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click();})()`); await delay(90); }
async function select(label, value) { await js(`(()=>{const el=document.querySelector('select[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`); await delay(90); }
async function draft(value) { await js(`(()=>{const el=document.querySelector('#work-prompt');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`); await delay(90); }
async function shot(name) { win.webContents.invalidate(); await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await delay(150); await fs.writeFile(path.join(out, name + '.png'), (await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()); }
function emit() { win.webContents.send('ui-event', { type: 'state', state }); }
ipcMain.handle('ui-fixture', (_event, method, arg) => {
  calls.push({ method, arg });
  if (method === 'snapshot') return state;
  if (method === 'status' || method === 'loadModel') return status;
  if (method === 'settings') { Object.assign(state.settings, arg); emit(); return state; }
  if (method === 'workspace') { if (arg.selected) state.workspace.selected = arg.selected; if ('sidebarCollapsed' in arg) state.workspace.sidebarCollapsed = arg.sidebarCollapsed; if (arg.draft) state.workspace.drafts[arg.draft.key] = arg.draft.text; return state.workspace; }
  if (method === 'newConversation') { state.conversations.push({ id: 'created', title: 'New conversation', messages: [], updatedAt: new Date().toISOString() }); emit(); return 'created'; }
  if (method === 'send') { if (failSend) throw new Error('Fixture connection failure'); return 'answer'; }
  if (method === 'reviewChange') { state.tasks[0].proposals[0].status = arg.decision === 'apply' ? 'applied' : 'rejected'; emit(); }
  if (method === 'deleteTask') { state.tasks = state.tasks.filter(t => t.id !== arg); delete state.workspace.drafts['task:' + arg]; emit(); }
  if (method === 'deleteConversation') { state.conversations = state.conversations.filter(c => c.id !== arg); delete state.workspace.drafts['chat:' + arg]; emit(); }
  if (method === 'searchModels') return [];
  if (method === 'startTask') { assert.equal(arg.taskId, 'task1'); return 'task1'; }
  if (method === 'stopTask') return delay(220).then(()=>{ assert.equal(arg,state.activeTask); state.activeTask=null;state.tasks[0].status='cancelled';emit();return state; });
  if (method === 'projectFiles') return { directory: '.', entries: [{ path: 'welcome.txt', type: 'file' }, { path: 'docs', type: 'directory' }], total: 2, excluded: 1, next_cursor: null };
  if (method === 'projectRead') return { path: arg.path, startLine: 1, totalLines: 2, content: '1: Welcome\n2: Open the app', next_start_char: null };
});
app.whenReady().then(async () => {
  await fs.mkdir(out, { recursive: true });
  const { DEFAULT_SETTINGS } = await import(require('node:url').pathToFileURL(path.join(root, 'electron/core.mjs')).href);
  const project = { name: 'Sample project', path: 'C:\\Fixture\\Project' };
  state = { settings: { ...DEFAULT_SETTINGS, model: 'fixture' }, workspace: { selected: 'new:task', sidebarCollapsed: false, drafts: {} }, project, downloads: [], activeChat: null, activeTask: null, endpoint: 'Bundled llama.cpp · local only', dataDir: 'Local fixture data', conversations: [
    { id: 'chat1', title: 'Plan the project', updatedAt: '2026-11-01T10:00:00Z', messages: [{ id: 'u1', role: 'user', content: 'Help me plan a local notes app.', status: 'complete' }, { id: 'a1', role: 'assistant', content: 'Start with a simple workspace.\n\n1. Keep notes in your project folder.\n2. Search them locally.\n3. Review changes before saving.\n\n![remote](https://example.invalid/tracker.png)<script>window.fixtureUnsafe=true</script>', status: 'complete', finishReason: 'length', usage: { completion_tokens: 1024 } }] }
  ], tasks: [{ id: 'task1', goal: 'Review the project and suggest a small improvement', project, updatedAt: '2026-11-01T11:00:00Z', status: 'completed', steps: 6, result: 'I inspected the project with a reviewer helper.\n\nThe welcome message can be clearer. **One file change is ready for your review.**', agents: [{ id: 'primary', name: 'AirloBot', role: 'primary', status: 'completed', goal: 'Review the project' }, { id: 'helper', name: 'Reviewer', role: 'reviewer', status: 'completed', goal: 'Inspect the welcome message', result: 'The title should describe the action.' }], events: [{ id: 'event1', type: 'tool', agent: 'Reviewer', at: '2026-11-01T11:00:00Z', detail: 'read_file {"path":"welcome.txt"}' }], proposals: [{ id: 'proposal1', path: 'welcome.txt', status: 'pending', reason: 'Make the next action clear.', before: 'Welcome\nOpen the app\n', after: 'Welcome\nChoose a project to begin\n' }] }] };
  const model = { key: 'fixture', display_name: 'Gemma 4 E4B', quantization: { name: 'Q4_K_M' }, params_string: '7.5B', loaded_instances: [{}] };
  status = { connected: true, models: [model], loaded: [model] };
  await fs.writeFile(path.join(out, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron'); const methods=${JSON.stringify(['snapshot','status','settings','workspace','loadModel','newConversation','send','reviewChange','searchModels','deleteTask','deleteConversation','startTask','stopTask','projectFiles','projectRead'])}; contextBridge.exposeInMainWorld('airlo',Object.assign(Object.fromEntries(methods.map(m=>[m,arg=>ipcRenderer.invoke('ui-fixture',m,arg)])),{subscribe:fn=>{const f=(_e,v)=>fn(v);ipcRenderer.on('ui-event',f);return()=>ipcRenderer.removeListener('ui-event',f);}}));`);
  protocol.handle('airlobot-test', async request => {
    const url = new URL(request.url), base = path.join(root, 'dist');
    const file = path.resolve(base, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (url.hostname !== 'app' || !file.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
    return new Response(await fs.readFile(file), { headers: { 'Content-Type': { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' }[path.extname(file)] || 'application/octet-stream' } });
  });
  const remote = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => { const allowed = details.url.startsWith('airlobot-test:'); if (!allowed) remote.push(details.url); callback({ cancel: !allowed }); });
  win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: path.join(out, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); console.error(event.message); } });
  await win.loadURL('airlobot-test://app/');
  for (let n = 0; n < 50; n++) { if (await js('Boolean(document.querySelector(".connection"))')) break; await delay(100); }
  await draft('An unsent project goal');
  assert.equal(await js('Boolean(document.querySelector(".project-control"))'), true);
  await select('Work mode', 'chat'); await draft('An unsent question');
  assert.equal(await js('Boolean(document.querySelector(".project-control"))'), false);
  await select('Work mode', 'task'); assert.equal(await js('document.querySelector("#work-prompt").value'), 'An unsent project goal');
  assert.equal(await js('Boolean(document.querySelector(".project-control"))'), true);
  await select('Work mode', 'chat'); assert.equal(await js('document.querySelector("#work-prompt").value'), 'An unsent question');
  await click('Settings'); await select('Response token limit', '8192'); await click('Save response preferences'); assert.equal(state.settings.maxTokens, 8192);
  await select('Response token limit', '-1'); await click('Save response preferences'); assert.equal(state.settings.maxTokens, -1);
  await click('Project tasks'); await select('Task turn limit', '-1'); assert.equal(state.settings.taskMaxTurns, -1);
  await select('Task time limit', '-1'); assert.equal(state.settings.taskMaxMinutes, -1);
  await select('Task turn limit', '100'); await select('Task time limit', '60');
  await click('← Workspace'); assert.equal(await js('document.querySelector("#work-prompt").value'), 'An unsent question');
  failSend = true; await click('Send'); assert.equal(await js('document.querySelector("#work-prompt").value'), 'An unsent question');
  assert.equal(state.workspace.selected, 'chat:created'); assert.equal(state.workspace.drafts['chat:created'], 'An unsent question'); failSend = false;
  await js('document.querySelector(".error-banner button").click()');
  await js('Array.from(document.querySelectorAll(".history-item")).find(b=>b.title==="Plan the project").click()'); await delay(90);
  assert.equal(await js('Boolean(document.querySelector(".markdown img") || window.fixtureUnsafe)'), false);
  await click('Continue response →'); assert.ok(calls.some(c => c.method === 'send' && c.arg.content.startsWith('Continue your previous response')));
  // Token events, late layout and user scroll intent all exercise the real UI.
  const streamed = state.conversations[0].messages[1];
  streamed.status = 'streaming'; streamed.finishReason = null;
  const token = async text => { streamed.content += text; win.webContents.send('ui-event',{type:'token',conversationId:'chat1',message:streamed}); await delay(65); };
  const gap = () => js('(()=>{const n=document.querySelector(".transcript-scroll");return n.scrollHeight-n.scrollTop-n.clientHeight;})()');
  const atBottom = async label => { for(let n=0;n<60;n++) { if(await gap()<3) return; win.webContents.invalidate();await delay(50); } assert.fail(label); };
  await token('\n\n' + 'Streaming paragraph with enough text to wrap across the conversation pane.\n\n'.repeat(60));
  assert.ok(await gap() < 3, 'New streamed content should follow the bottom');
  for(let i=0;i<8;i++) await token('More streamed output.\n\n'.repeat(8));
  assert.ok(await gap() < 3, 'Long bursts must not disable following');
  await js('(()=>{const n=document.querySelector(".transcript-scroll");n.scrollTop=100;n.dispatchEvent(new Event("scroll"));})()'); await delay(90);
  assert.equal(await js('Boolean(document.querySelector(".jump-latest"))'),true,'Scroll-up should reveal Jump to latest');
  const readingPosition = await js('document.querySelector(".transcript-scroll").scrollTop');
  await token('New output while reading history.\n\n'.repeat(15));
  const afterTokenPosition = await js('document.querySelector(".transcript-scroll").scrollTop');
  assert.ok(Math.abs(afterTokenPosition - readingPosition) < 2, `Reading earlier messages should stay put: ${readingPosition} -> ${afterTokenPosition}`);
  await click('Jump to latest'); assert.ok(await gap() < 3);
  // No token or React state event: expanding reasoning/layout should still follow.
  await js('document.querySelector(".chat-transcript").style.paddingBottom="550px"'); await delay(100);
  await atBottom('Late content layout should follow');
  win.setSize(1100,700); await delay(150); await atBottom('Window resizing should keep the latest text visible');
  await js('document.querySelector(".chat-transcript").style.paddingBottom=""');
  win.setSize(1440,900); streamed.content='A short completed reply.'; streamed.status='complete'; emit(); await delay(90);
  report.push({check:'stream following, scroll-up preservation, jump to latest, late layout and resize',passed:true});
  await js('Array.from(document.querySelectorAll(".history-item")).find(b=>b.title.startsWith("Review the project")).click()'); await delay(90);
  assert.equal(await js('Boolean(document.querySelector(".detail-panel"))'), false);
  await draft('Follow up on this project'); await click('Send');
  assert.deepEqual(calls.filter(c => c.method === 'startTask').at(-1).arg, {goal:'Follow up on this project',taskId:'task1'});
  assert.equal(state.workspace.selected, 'task:task1');
  await click('Files'); assert.equal(calls.filter(c => c.method === 'projectFiles').at(-1).arg.taskId,'task1');
  await click('welcome.txt'); assert.match(await js('document.querySelector(".file-preview").textContent'), /Welcome/);
  await click('Use this file in my request'); assert.equal(await js('document.querySelector("#work-prompt").value'), 'File: welcome.txt');
  await shot('project-file-preview');
  await js(`document.querySelector('[aria-label="Close project files"]').click()`); await delay(90);
  await click('Review 1 change'); assert.equal(calls.filter(c => c.method === 'reviewChange').length, 0);
  assert.match(await js('document.querySelector(".change-preview").textContent'), /Choose a project/);
  const applyDisabled=()=>js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Apply change").disabled');
  state.activeTask='task1'; state.tasks[0].status='running';emit();await delay(90);
  assert.equal(await applyDisabled(),true);
  assert.match(await js('document.querySelector(".review-lock").textContent'),/still preparing changes/);
  await shot('review-while-running');
  await click('Stop and review'); assert.equal(await applyDisabled(),true,'Keep approval locked while cancellation drains');
  await delay(220);assert.equal(await applyDisabled(),false,'Stop unlocks approval without reopening the task');
  assert.equal(calls.filter(c=>c.method==='reviewChange').length,0,'Stopping must not apply proposals');
  await click('Apply change');assert.equal(state.tasks[0].proposals[0].status,'applied');
  state.tasks[0].proposals[0].status='pending';state.tasks[0].status='awaiting_review';state.activeChat='chat1';emit();await delay(90);
  assert.equal(await applyDisabled(),false,'Read-only chat must not block file review');
  state.activeChat=null;state.activeTask='another-task';emit();await delay(90);
  assert.equal(await applyDisabled(),true);assert.match(await js('document.querySelector(".review-lock").textContent'),/Another project task/);
  state.activeTask=null;emit();await delay(90);
  report.push({check:'review lock reason, Stop and review, apply after cancellation, chat does not block approval',passed:true});
  await shot('dark-review'); await click('Helpers'); assert.match(await js('document.querySelector(".detail-scroll").textContent'), /one at a time/);
  await js('Array.from(document.querySelectorAll(".detail-panel .tabs button")).find(b=>b.textContent.startsWith("Changes")).click()'); await delay(90);
  win.setSize(1000, 680); await delay(150); assert.equal(await js('Boolean(document.querySelector("dialog[open]"))'), true);
  await shot('dark-compact-review');
  await js('document.querySelector("dialog").dispatchEvent(new Event("cancel",{cancelable:true}))'); await delay(90);
  assert.equal(await js('Boolean(document.querySelector("dialog[open]"))'), false);
  await click('Review 1 change'); await click('Reject'); assert.deepEqual(calls.filter(c => c.method === 'reviewChange').at(-1).arg, { taskId:'task1', proposalId:'proposal1', decision:'reject' });
  await js('document.querySelector("dialog").dispatchEvent(new Event("cancel",{cancelable:true}))'); await delay(90);
  await click('New task');
  for (const theme of ['dark', 'light', 'glass']) {
    state.settings.theme = theme; emit(); await delay(100);
    for (const connected of ['ready', 'no-model', 'offline', 'other-model']) {
      model.loaded_instances = connected === 'ready' ? [{}] : [];
      status = { connected: connected !== 'offline', models: connected === 'offline' ? [] : [model, ...(connected === 'other-model' ? [{key:'other',loaded_instances:[{}]}] : [])], loaded: [] };
      // Reload exercises persistence and the actual startup status fetch.
      await win.reload(); await delay(250);
      const result = await js(`(()=>{const el=document.querySelector('.connection'); const n=document.querySelector('.foot-note'); const r=n.getBoundingClientRect();return {label:el.textContent,color:getComputedStyle(el).color,dot:getComputedStyle(el.querySelector('.connection-dot')).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,footVisible:r.bottom<=innerHeight&&r.right<=innerWidth,theme:document.documentElement.dataset.theme};})()`);
      assert.equal(result.label, connected === 'ready' ? 'Local engine connected' : 'No model loaded');
      assert.equal(result.color, result.dot); assert.equal(result.overflow, false); assert.equal(result.footVisible, true); assert.equal(result.theme, theme);
      if (connected === 'ready') { assert.equal(result.color, theme === 'dark' ? 'rgb(74, 222, 128)' : 'rgb(8, 127, 63)'); await shot(theme + '-compact'); }
      report.push({ theme, connected, ...result });
    }
    win.setSize(1440, 900); await delay(100); await shot(theme + '-workspace');
    await click('Settings'); await click('Appearance'); await js('document.querySelector(".appearance").scrollIntoView()'); await delay(90); await shot(theme + '-appearance');
    await click('← Workspace'); win.setSize(1000, 680); await delay(100);
  }
  await click('Settings');
  await click('Appearance');
  await js('document.querySelector(".theme-light").click()'); await delay(90); assert.equal(state.settings.theme, 'light');
  await js('document.querySelector(".theme-glass").click()'); await delay(90); assert.equal(state.settings.theme, 'glass');
  await js(`document.querySelector('[aria-label="Reduce transparency"]').click()`); await delay(90);
  assert.equal(state.settings.reducedTransparency, true);
  assert.equal(await js('getComputedStyle(document.querySelector(".sidebar")).backdropFilter'), 'none');
  await js(`document.querySelector('[aria-label="Reduced motion"]').click()`); await delay(90); assert.equal(state.settings.reducedMotion, true);
  await click('← Workspace');
  await js(`document.querySelector('[aria-label="Collapse sidebar"]').click()`); await delay(90); assert.equal(state.workspace.sidebarCollapsed, true);
  assert.ok(await js('document.querySelector(".sidebar").getBoundingClientRect().width<100'));
  await click('Model library'); assert.equal(calls.filter(c=>c.method==='searchModels').length, 0);
  await click('← Workspace');
  await js('Array.from(document.querySelectorAll(".history-item")).find(b=>b.title.startsWith("Review the project")).click()'); await delay(90);
  state.activeTask = 'task1'; emit(); await delay(90);
  assert.equal(await js(`document.querySelector('[title="Delete task"]').disabled`), true);
  state.activeTask = null; emit(); await delay(90);
  await js(`document.querySelector('[title="Delete task"]').click()`); await delay(90);
  assert.match(await js('document.querySelector("dialog").textContent'), /project files are kept/);
  await click('Keep work'); assert.equal(calls.filter(c=>c.method==='deleteTask').length, 0);
  await js(`document.querySelector('[title="Delete task"]').click()`); await delay(90); await click('Delete task');
  assert.equal(state.tasks.length, 0); assert.equal(state.workspace.selected, 'new:task');
  await js(`document.querySelector('[aria-label="Delete New conversation"]').click()`); await delay(90); await click('Delete conversation');
  assert.equal(state.conversations.some(c=>c.id==='created'), false);
  assert.equal(remote.length, 0); assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out,'report.json'), JSON.stringify({ scenarios:report, checks:['draft navigation and failed-send recovery','unlimited and 8192 preferences','continuation','review stays explicit','responsive review dialog','theme contrast and overflow','no remote renderer requests'], errors, passed:true },null,2));
  console.log('PASS: Focus renderer interactions and 12 connection/theme scenarios. Screenshots: ' + out);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
