import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalRuntime, runtimeArguments, runtimeEnvironment } from '../electron/runtime.mjs';
import { inspectModel } from '../electron/model-files.mjs';
import { AirloService } from '../electron/core.mjs';
import { ProjectFiles, rememberRead } from '../electron/project.mjs';

async function fixture(t, options = {}) {
  const parent = path.resolve('test-results/standalone-unit'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-')), project = path.join(root, 'project'); await fs.mkdir(project);
  const service = new AirloService(path.join(root, 'state'), () => {}, options); await service.init(); await service.selectProject(project);
  t.after(async () => { await service.shutdown(); assert.ok(root.startsWith(parent + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return { root, project, service, files: await ProjectFiles.open(project) };
}
const answer = content => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] });
const call = (name, args) => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

test('runtime restricts inference to its owned loopback process and keeps authentication out of status', async t => {
  const runtime = new LocalRuntime();
  await assert.rejects(runtime.fetch('/v1/models'), /Load/);
  runtime.child = {}; runtime.origin = 'http://127.0.0.1:29801'; runtime.secret = 'test-session-secret'; runtime.phase = 'ready';
  const original = global.fetch; t.after(() => { global.fetch = original; runtime.child = null; });
  global.fetch = async (url, options) => { assert.equal(url, runtime.origin + '/v1/models'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer test-session-secret'); return Response.json({ data: [] }); };
  await runtime.fetch('/v1/models');
  for (const route of ['//cloud.example', 'https://cloud.example', '/props', '/tools', '/v1/models?redirect=x']) await assert.rejects(runtime.fetch(route), /Invalid/);
  assert.ok(!JSON.stringify(await runtime.status()).includes(runtime.secret));
  global.fetch = async () => new Response('secret prompt echoed by engine', { status: 400 });
  await assert.rejects(runtime.fetch('/v1/models'), e => !e.message.includes('secret prompt'));
});

test('runtime cannot inherit cloud, remote binding, built-in agent tools or log settings', () => {
  const env = runtimeEnvironment('local-secret', { PATH: 'runtime-path', SystemRoot: 'system-root', LLAMA_ARG_HOST: '0.0.0.0', LLAMA_ARG_TOOLS: 'all', LLAMA_ARG_LOG_FILE: 'capture.log', HF_TOKEN: 'private', HTTPS_PROXY: 'remote' });
  assert.deepEqual(env, { PATH: 'runtime-path', SystemRoot: 'system-root', LLAMA_API_KEY: 'local-secret' });
  const args = runtimeArguments({ path: 'local.gguf', key: 'model', max_context_length: 8192 }, 29801, { contextTokens: 16384, acceleration: 'cpu' });
  assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1'); assert.equal(args[args.indexOf('--ctx-size') + 1], '8192');
  for (const flag of ['--offline', '--no-agent', '--no-webui', '--no-ui-mcp-proxy', '--log-disable']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--n-gpu-layers') + 1], '0');
});

test('GGUF registration validates metadata, rejects malformed files and retains the original file', async t => {
  const { root, service } = await fixture(t);
  const str = s => { const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(Buffer.byteLength(s))); return Buffer.concat([len, Buffer.from(s)]); };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const header = Buffer.alloc(24); header.write('GGUF'); header.writeUInt32LE(3,4); header.writeBigUInt64LE(1n,16);
  const bytes = Buffer.concat([header,str('general.architecture'),u32(8),str('fixture')]), file = path.join(root, 'fixture-Q4_K_M.gguf');
  await fs.writeFile(file, bytes); const model = await service.registerModel(file);
  assert.equal(model.architecture, 'fixture'); assert.equal(model.path, await fs.realpath(file)); assert.equal(service.state.models.length, 1);
  await service.registerModel(file); assert.equal(service.state.models.length, 1); assert.deepEqual(await fs.readFile(file), bytes);
  await fs.writeFile(path.join(root, 'bad.gguf'), 'GGUFbad'); await assert.rejects(inspectModel(path.join(root, 'bad.gguf')));
  const restarted = new AirloService(service.dataDir); await restarted.init(); assert.equal(restarted.state.models[0].path, model.path); await restarted.shutdown();
});

test('paged discovery reaches deep folders and paged reads authorize exact edits in large files', async t => {
  const { project, files } = await fixture(t);
  await Promise.all(Array.from({ length: 125 }, (_, i) => fs.writeFile(path.join(project, `item-${String(i).padStart(3,'0')}.txt`), 'small')));
  const deep = 'one/two/three/four/five/six'; await fs.mkdir(path.join(project, deep), { recursive: true });
  const text = 'line\n'.repeat(1600) + 'UNIQUE TARGET\n' + 'last\n'.repeat(1600); await fs.writeFile(path.join(project, deep, 'notes.md'), text);
  const page = await files.list(); assert.equal(page.entries.length, 100); assert.equal(page.next_cursor, 100);
  const rest = await files.list('.', undefined, page.next_cursor); assert.equal(rest.entries.length, 26);
  assert.equal((await files.list(deep)).entries[0].path, deep + '/notes.md');
  assert.ok((await files.search('UNIQUE TARGET')).matches.some(m => m.path.endsWith('notes.md')));
  const capped = await files.search('line', deep);
  assert.equal(capped.matches.length, 30); assert.equal(capped.truncated, true);
  assert.match(capped.note, /inside this file/);
  const name = deep + '/notes.md', reads = new Map(), read = await files.read(name, 1601, 3); rememberRead(reads, read);
  await assert.rejects(files.prepareEdit(name, 'UNIQUE TARGET', 'NEW TARGET', 'change', new Map()), /Read/);
  const edit = await files.prepareEdit(name, 'UNIQUE TARGET', 'NEW TARGET', 'change', reads);
  assert.equal(edit.after, text.replace('UNIQUE TARGET', 'NEW TARGET'));
  edit.appliedHash = await files.apply(edit); await files.undo(edit); assert.equal(await fs.readFile(path.join(project,name),'utf8'), text);
  const all = new Map(); let offset = 0;
  do { const chunk = await files.read(name, 1, 200, offset); rememberRead(all, chunk); offset = chunk.next_start_char; } while (offset !== null);
  assert.equal(all.get(name).complete, true);
});

test('reviewed directory and document creation, conflict detection and undo preserve user work', async t => {
  const { files, project } = await fixture(t);
  const folder = await files.prepareDirectory('docs/notes', 'Organize notes');
  const document = await files.prepare('docs/notes/overview.md', '# Overview\n', 'Create document', new Map(), [folder]);
  await assert.rejects(fs.stat(path.join(project,'docs')), { code: 'ENOENT' });
  await files.apply(folder); document.appliedHash = await files.apply(document);
  await assert.rejects(files.undo(folder), /contains files/);
  await fs.writeFile(path.join(project,document.path),'user edit'); await assert.rejects(files.undo(document), /newer work/);
  await fs.writeFile(path.join(project,document.path),document.after); await files.undo(document); await files.undo(folder);
  await assert.rejects(fs.stat(path.join(project,'docs')), { code: 'ENOENT' });
  for (const bad of ['../outside', '.ssh/secrets']) await assert.rejects(files.prepareDirectory(bad,'invalid'));
  await assert.rejects(files.prepare('notes.docx', 'not a real Word file', 'invalid', new Map()), /dedicated document editor/);
});

test('follow-ups keep one conversation, its original folder and applied state across restart', async t => {
  let request = 0; const bodies = [];
  const { root, project, service } = await fixture(t, { agentRequest: async body => { bodies.push(structuredClone(body)); return request++ % 2 === 0 ? call('read_file', { path: 'notes.md' }) : answer('The project name is Orchard.'); } });
  await fs.writeFile(path.join(project,'notes.md'),'# Orchard\n');
  const id = await service.startTask({ goal: 'Read notes.md and identify the project.' }); await service.agentPromise;
  const alternate = path.join(root, 'different'); await fs.mkdir(alternate); await service.selectProject(alternate);
  const follow = await service.startTask({ taskId: id, goal: 'What was its name? Check the same file again.' }); await service.agentPromise;
  assert.equal(follow,id); assert.equal(service.state.tasks.length,1); assert.equal(service.state.tasks[0].runs.length,1);
  assert.equal(service.state.tasks[0].project.path, project); assert.equal(service.state.tasks[0].status,'completed');
  assert.ok(bodies[2].messages.some(m => m.role === 'assistant' && m.content.includes('Orchard')));
  const restored = new AirloService(service.dataDir); await restored.init();
  assert.equal(restored.state.tasks[0].runs[0].goal,'Read notes.md and identify the project.'); await restored.shutdown();
  assert.equal((await service.projectFiles({taskId:id})).entries[0].path,'notes.md');
});

test('text-only project answers are not labeled as completed file work', async t => {
  const { service } = await fixture(t, { agentRequest: async () => answer('I have finished everything.') });
  await service.startTask({ goal: 'Inspect the project.' }); await service.agentPromise;
  assert.equal(service.state.tasks[0].status,'needs_input'); assert.equal(service.state.tasks[0].proposals.length,0);
});

test('failed edits cannot become completed claims; recoverable failures use real proposals', async t => {
  const { project, service } = await fixture(t);
  await fs.writeFile(path.join(project, 'notes.md'), '# Original\n');
  let turn = 0;
  service.options.agentRequest = async () => turn++ === 0 ? call('read_file', { path: 'notes.md' }) : turn === 2 ? call('propose_edit', { path: 'notes.md', old_text: 'missing', new_text: 'replacement', reason: 'Change heading' }) : answer('The change is ready for review.');
  const id = await service.startTask({ goal: 'Change the heading in notes.md.' }); await service.agentPromise;
  assert.equal(service.state.tasks[0].status, 'needs_attention'); assert.equal(service.state.tasks[0].proposals.length, 0); assert.equal(turn, 5);
  assert.equal(await fs.readFile(path.join(project, 'notes.md'), 'utf8'), '# Original\n');
  const sequence = [call('read_file', { path: 'notes.md' }), answer(''), call('propose_edit', { path: 'notes.md', old_text: '# Original', new_text: '# Revised', reason: 'Requested heading' }), answer('A change is ready for review.')];
  service.options.agentRequest = async () => sequence.shift();
  await service.startTask({ taskId: id, goal: 'Please retry with the exact heading.' }); await service.agentPromise;
  assert.equal(service.state.tasks[0].status, 'awaiting_review'); assert.equal(service.state.tasks[0].proposals.length, 1);
  assert.ok(service.state.tasks[0].events.some(e => e.type === 'retry'));
});

test('long-line read cursors make progress and targeted edits retain CRLF', async t => {
  const { project, files } = await fixture(t);
  const text = 'A'.repeat(9000) + '\r\n# Before\r\nKeep this.\r\n'; await fs.writeFile(path.join(project, 'windows.md'), text);
  const reads = new Map(); let offset = 0, pages = 0;
  do { const read = await files.read('windows.md', 1, 1, offset); rememberRead(reads, read); assert.ok(read.next_start_char === null || read.next_start_char > offset); offset = read.next_start_char; assert.ok(++pages < 10); } while (offset !== null);
  assert.equal(reads.get('windows.md').complete, true);
  const change = await files.prepareEdit('windows.md', '# Before\nKeep this.', '# After\nKeep this.', 'Change heading', reads);
  assert.equal(change.after, text.replace('# Before', '# After'));
});
