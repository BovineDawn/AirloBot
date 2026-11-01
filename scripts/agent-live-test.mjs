import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AirloService, MODEL } from '../electron/core.mjs';

const root = path.resolve('test-results/agent-live-' + Date.now());
const project = path.join(root, 'project'); await fs.mkdir(project, { recursive: true });
const original = 'export function add(a, b) { return a - b; }\n';
await fs.writeFile(path.join(project, 'calculator.js'), original);
await fs.writeFile(path.join(project, 'README.txt'), 'This is a tiny addition library. add(2, 3) must return 5. calculator.js contains the implementation.\n');
const report = { startedAt: new Date().toISOString(), project, model: MODEL };
const service = new AirloService(path.join(root, 'state'));
try {
  await service.init(); await service.loadModel(MODEL); await service.settings({ offline: true }); await service.selectProject(project);
  const id = await service.startTask({ goal: 'Read README.txt and calculator.js. Create a reviewer helper to inspect add in calculator.js against the README requirement. Use the helper findings, read the file yourself if needed, and propose a corrected calculator.js for user review. Do not run commands. End with the evidence and proposal status.' });
  await service.agentPromise;
  const task = service.state.tasks.find(t => t.id === id); report.task = task;
  assert.equal(task.status, 'completed', task.error);
  assert.ok(task.agents.length >= 2, 'A real local helper was created');
  assert.ok(task.agents.slice(1).some(a => a.status === 'completed'), 'A helper completed');
  assert.ok(task.events.some(e => e.type === 'tool' && e.detail.startsWith('read_file')), 'Real project reads occurred');
  const proposal = task.proposals.find(p => p.path === 'calculator.js'); assert.ok(proposal, 'A file change was proposed');
  assert.match(proposal.after, /a\s*\+\s*b/);
  assert.equal(await fs.readFile(path.join(project, 'calculator.js'), 'utf8'), original, 'Model did not write without review');
  await service.reviewChange({ taskId: id, proposalId: proposal.id, decision: 'apply' });
  assert.equal(await fs.readFile(path.join(project, 'calculator.js'), 'utf8'), proposal.after);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }
finally { await service.shutdown(); await fs.writeFile('test-results/agent-live-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, error: report.error, project, steps: report.task?.steps, agents: report.task?.agents.map(a => ({ name: a.name, status: a.status })), proposals: report.task?.proposals.length, result: report.task?.result }, null, 2)); }
