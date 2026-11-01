import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectFiles, projectPath } from '../electron/project.mjs';
import { AirloService } from '../electron/core.mjs';
import { AgentRunner, makeTask } from '../electron/agents.mjs';

async function fixture(t, options = {}) {
  const parent = path.resolve('test-results/agents-unit'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-')), project = path.join(root, 'project');
  await fs.mkdir(project); await fs.writeFile(path.join(project, 'sum.js'), 'export const sum = (a, b) => a - b;\n');
  await fs.writeFile(path.join(project, 'README.txt'), 'sum(2, 3) must be 5.\n');
  const service = new AirloService(path.join(root, 'state'), () => {}, options); await service.init();
  await service.selectProject(project);
  t.after(async () => { await service.shutdown(); assert.ok(root.startsWith(parent + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return { root, project, service, files: await ProjectFiles.open(project) };
}
const call = (name, args, id = 'c1') => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] } }] });
const answer = content => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] });

test('project tools confine paths, skip secrets and reject links/binary/oversized text', async t => {
  const { root, project, files } = await fixture(t);
  for (const value of ['../escape', '/etc/passwd', 'C:\\secret.txt', 'file.txt:stream', '.git/config', '.env.local', '.ssh/key', 'a/../b', 'a/.. /b', 'NUL.txt']) assert.throws(() => projectPath(value));
  await fs.writeFile(path.join(project, '.env'), 'secret=private');
  await fs.writeFile(path.join(project, 'binary.bin'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(project, 'large.txt'), 'a'.repeat(65537));
  const outside = path.join(root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.txt'), 'not part of the project');
  await fs.symlink(outside, path.join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(files.read('link/secret.txt'), /links|junctions/);
  await assert.rejects(files.read('binary.bin'), /Binary/);
  await assert.rejects(files.read('large.txt'), /64 KiB/);
  const listed = await files.list(); assert.ok(!listed.entries.some(e => /link|\.env/.test(e.path)));
  const search = await files.search('sum'); assert.equal(search.matches.length, 2); assert.ok(search.skipped >= 2);
  assert.equal((await files.read('sum.js')).complete, true);
});

test('proposals require current full reads and explicit review; stale writes are rejected', async t => {
  const { files, project } = await fixture(t);
  await assert.rejects(files.prepare('sum.js', 'fixed', 'Fix sum', new Map()), /Read the entire/);
  const read = await files.read('sum.js'), reads = new Map([['sum.js', read]]);
  const proposal = await files.prepare('sum.js', 'export const sum = (a, b) => a + b;\n', 'Use addition', reads);
  assert.match(await fs.readFile(path.join(project, 'sum.js'), 'utf8'), /a - b/);
  await fs.writeFile(path.join(project, 'sum.js'), 'user edit');
  await assert.rejects(files.apply(proposal), /file changed/);
  assert.equal(await fs.readFile(path.join(project, 'sum.js'), 'utf8'), 'user edit');
  const fresh = await files.prepare('new.txt', 'new content', 'Create file', reads);
  await files.apply(fresh); assert.equal(await fs.readFile(path.join(project, 'new.txt'), 'utf8'), 'new content');
  await assert.rejects(files.apply(fresh), /file changed/);
});

test('primary delegates to the same model with read-only helper tools, proposes, then host applies', async t => {
  const sequence = [call('spawn_agent', { role: 'reviewer', task: 'Read sum.js and check addition' }), call('read_file', { path: 'sum.js' }), answer('sum.js:1 subtracts instead of adding.'), call('read_file', { path: 'sum.js' }), call('propose_file', { path: 'sum.js', content: 'export const sum = (a, b) => a + b;\n', reason: 'Correct addition' }), answer('A reviewer found the issue in sum.js:1. The fix is proposed for review.')];
  let count = 0;
  const { service, project } = await fixture(t, { agentRequest: async body => {
    assert.equal(body.model, service.state.settings.model);
    if (count === 1 || count === 2) assert.deepEqual(body.tools.map(t => t.function.name), ['list_files', 'read_file', 'search_text']);
    return sequence[count++];
  } });
  const id = await service.startTask({ goal: 'Review and fix sum with a helper' }); await service.agentPromise;
  const task = service.state.tasks[0]; assert.equal(task.status, 'completed'); assert.equal(task.agents.length, 2);
  assert.ok(task.agents.every(a => a.status === 'completed')); assert.equal(task.proposals[0].status, 'pending');
  assert.match(await fs.readFile(path.join(project, 'sum.js'), 'utf8'), /a - b/);
  await service.reviewChange({ taskId: id, proposalId: task.proposals[0].id, decision: 'apply' });
  assert.match(await fs.readFile(path.join(project, 'sum.js'), 'utf8'), /a \+ b/);
  await assert.rejects(service.reviewChange({ taskId: id, proposalId: task.proposals[0].id, decision: 'apply' }), /no longer/);
  const restarted = new AirloService(service.dataDir); await restarted.init();
  assert.equal(restarted.state.tasks[0].proposals[0].status, 'applied');
});

test('unknown tools, malformed JSON, extra arguments and nested delegation never execute', async t => {
  let count = 0;
  const sequence = [call('run_command', { command: 'anything' }), call('read_file', '{broken'), call('read_file', { path: 'sum.js', extra: 'no' }), call('spawn_agent', { role: 'reviewer', task: 'Inspect sum.js' }), call('spawn_agent', { role: 'reviewer', task: 'Nested helper' }), answer('Nested delegation is unavailable.'), answer('Stopped after tool errors.')];
  const { service } = await fixture(t, { agentRequest: async () => sequence[count++] });
  await service.startTask({ goal: 'Test invalid requests' }); await service.agentPromise;
  assert.equal(service.state.tasks[0].agents.length, 2);
  assert.equal(service.state.tasks[0].events.filter(e => e.type === 'tool_error').length, 4);
  assert.equal(service.state.tasks[0].proposals.length, 0);
});

test('cancelling a helper cancels its parent and releases the local generation slot', async t => {
  let notify; const started = new Promise(resolve => { notify = resolve; }); let count = 0;
  const { service } = await fixture(t, { agentRequest: async (_body, signal) => {
    if (!count++) return call('spawn_agent', { role: 'researcher', task: 'Read project' });
    notify(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const id = await service.startTask({ goal: 'Inspect project' }); await started;
  await assert.rejects(service.startTask({ goal: 'Duplicate' }), /current work/);
  await assert.rejects(service.loadModel('anything'), /Stop/);
  await assert.rejects(service.send({ conversationId: 'none', content: 'hello' }), /project task/);
  service.stopTask(id); await service.agentPromise;
  assert.equal(service.activeTask, null); assert.equal(service.state.tasks[0].status, 'cancelled');
  assert.ok(service.state.tasks[0].agents.every(a => a.status === 'cancelled'));
});

test('restart marks unfinished work and uncertain writes without replaying actions', async t => {
  const { service } = await fixture(t);
  const task = makeTask('Old task', service.state.project, service.state.settings.model);
  task.agents.push({ id: 'a', status: 'running' }); task.proposals.push({ id: 'p', status: 'applying' });
  service.state.tasks.push(task); await service.save();
  const restarted = new AirloService(service.dataDir, () => {}, { agentRequest: () => { throw new Error('Must never replay'); } }); await restarted.init();
  assert.equal(restarted.state.tasks[0].status, 'interrupted');
  assert.equal(restarted.state.tasks[0].agents[0].status, 'interrupted');
  assert.equal(restarted.state.tasks[0].proposals[0].status, 'uncertain');
  assert.equal(restarted.activeTask, null);
});

test('a looping model stops at the host budget', async t => {
  const { files } = await fixture(t), task = makeTask('loop', { path: files.root }, 'local');
  const runner = new AgentRunner(task, { request: async () => call('read_file', { path: 'sum.js' }), changed: async () => {}, signal: new AbortController().signal, maxSteps: 4 });
  await runner.run(); assert.equal(task.status, 'failed'); assert.equal(task.steps, 4); assert.match(task.error, /step limit/);
});

test('rejected proposals remain unwritten and cannot be applied from another project', async t => {
  const { service, files, root, project } = await fixture(t);
  const task = makeTask('create', service.state.project, service.state.settings.model); task.status = 'completed';
  const proposal = await files.prepare('new.txt', 'pending', 'Create', new Map()); task.proposals.push(proposal); service.state.tasks.push(task);
  const alternate = path.join(root, 'alternate'); await fs.mkdir(alternate); await service.selectProject(alternate);
  await assert.rejects(service.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'apply' }), /Select this task/);
  await service.selectProject(project); await service.reviewChange({ taskId: task.id, proposalId: proposal.id, decision: 'reject' });
  await assert.rejects(fs.stat(path.join(project, 'new.txt')), { code: 'ENOENT' }); assert.equal(proposal.status, 'rejected');
});
