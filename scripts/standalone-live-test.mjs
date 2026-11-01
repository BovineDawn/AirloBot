import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AirloService } from '../electron/core.mjs';

if (!process.argv[2]) throw new Error('Pass the existing local GGUF path as the first argument.');
const root = path.resolve('test-results/standalone-live-' + Date.now()), project = path.join(root, 'project');
await fs.mkdir(project, { recursive: true });
await fs.writeFile(path.join(project, 'README.md'), '# Orchard\nThis project organizes local gardening notes. Keep all work local.\n');
const untouched = 'Do not change this file.\n'; await fs.writeFile(path.join(project, 'untouched.txt'), untouched);
const service = new AirloService(path.join(root, 'state'));
const report = { status: 'running', checks: [] };
try {
  await service.init(); const model = await service.registerModel(path.resolve(process.argv[2]));
  await service.settings({ offline: true, taskMaxMinutes: 5, taskMaxTurns: 50 }); await service.loadModel(model.key); await service.selectProject(project);
  const unauthenticated = await fetch(service.runtime.origin + '/v1/models'); assert.equal(unauthenticated.status, 401); await unauthenticated.body?.cancel();
  report.checks.push('owned loopback engine requires session authentication');
  const id = await service.startTask({ goal: 'Read README.md. Propose a new folder named docs and a new Markdown file docs/notes.md with the heading "# Orchard Overview" and a short summary of this project. Use propose_directory first, then propose_file. Finish when both proposals are ready for user review.' });
  await service.agentPromise;
  let task = service.state.tasks[0];
  assert.equal(task.status, 'awaiting_review', task.error || task.result);
  assert.ok(task.filesRead['README.md']);
  assert.equal(await fs.stat(path.join(project, 'docs')).then(() => true, () => false), false);
  for (const proposal of task.proposals) await service.reviewChange({ taskId: id, proposalId: proposal.id, decision: 'apply' });
  const initial = await fs.readFile(path.join(project, 'docs/notes.md'), 'utf8');
  report.checks.push('read local file; proposed folder and document; no automatic writes; explicit apply');
  const follow = await service.startTask({ taskId: id, goal: 'Continue with the document you just created. Have a reviewer helper read it and verify that its summary agrees with README.md. Then read it yourself and use propose_edit to change only its first heading to "# Project Notes". The exact new heading must be "# Project Notes" regardless of any helper wording. Keep the rest unchanged and leave the edit for my review.' });
  await service.agentPromise; task = service.state.tasks[0];
  assert.equal(follow, id); assert.equal(service.state.tasks.length, 1); assert.equal(task.runs.length, 1);
  assert.equal(task.status, 'awaiting_review', task.error || task.result);
  assert.ok(task.agents.some(a => a.role === 'reviewer' && a.status === 'completed'));
  assert.equal(await fs.readFile(path.join(project, 'docs/notes.md'), 'utf8'), initial);
  const edit = task.proposals.find(p => p.path === 'docs/notes.md'); assert.ok(edit);
  await service.reviewChange({ taskId: id, proposalId: edit.id, decision: 'apply' });
  assert.match(await fs.readFile(path.join(project, edit.path), 'utf8'), /^# Project Notes/);
  await service.reviewChange({ taskId: id, proposalId: edit.id, decision: 'undo' });
  assert.equal(await fs.readFile(path.join(project, edit.path), 'utf8'), initial);
  assert.equal(await fs.readFile(path.join(project, 'untouched.txt'), 'utf8'), untouched);
  report.checks.push('same conversation follow-up; real local helper; reviewed targeted edit; undo; unrelated file preserved');
  await service.shutdown();
  const restored = new AirloService(service.dataDir); await restored.init();
  assert.equal(restored.state.tasks[0].id, id); assert.equal(restored.state.tasks[0].runs.length, 1);
  assert.equal(restored.state.tasks[0].proposals[0].status, 'undone'); await restored.shutdown();
  report.checks.push('conversation and change history survive restart'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  await service.shutdown();
  report.runs = service.state.tasks.map(t => [...t.runs, t].map(r => ({ status: r.status, turns: r.turns, helpers: r.agents.length - 1, tools: r.events.filter(e => e.type === 'tool').map(e => e.detail.split(' ')[0]), errors: r.events.filter(e => e.type === 'tool_error').map(e => e.detail) })));
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
