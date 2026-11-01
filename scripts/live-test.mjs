import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { CrocService, MODEL } from '../electron/core.mjs';
const dir = path.resolve('test-results/live-' + Date.now());
const report = { startedAt: new Date().toISOString(), dataDir: dir, tests: [] };
const service = new CrocService(dir, () => {}, { importModels: false });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 120000) { const start = Date.now(); while (!fn()) { if (Date.now() - start > timeout) throw new Error('Live operation timed out'); await wait(100); } await service.saveChain; }
try {
  await service.init(); const status = await service.status(); assert.equal(status.connected, true);
  assert.ok(status.models.some(m => m.key === MODEL));
  await service.loadModel(MODEL); await service.settings({ maxTokens: 256, temperature: 0.1, offline: true });
  const id = await service.newConversation();
  await service.send({ conversationId: id, content: 'Reply with one short sentence containing the words CrocBot and local. Then give the answer to 17 + 25.' });
  await until(() => !service.activeChat);
  const answer = service.state.conversations[0].messages.at(-1);
  assert.equal(answer.status, 'complete', JSON.stringify(answer)); assert.match(answer.content, /42/);
  report.tests.push({ name: 'Gemma local inference with offline mode on', passed: true, model: MODEL, output: answer.content, elapsedMs: answer.elapsedMs, usage: answer.usage });
  await service.settings({ offline: false });
  const search = await service.searchModels('Gemma'); assert.ok(search.length);
  report.tests.push({ name: 'Hugging Face search', passed: true, results: search.length });
  const files = await service.modelFiles('ggml-org/models');
  const file = files.files.find(f => f.name === 'tinyllamas/stories260K.gguf'); assert.ok(file);
  const downloadId = await service.startDownload({ repo: files.repo, filename: file.name });
  await until(() => !service.downloadJobs.size);
  const download = service.state.downloads.find(d => d.id === downloadId);
  assert.equal(download.status, 'complete', JSON.stringify(download));
  report.tests.push({ name: 'Real public GGUF download and SHA-256 validation', passed: true, repo: files.repo, filename: file.name, bytes: download.received, sha256: download.sha256 });
  const restored = new CrocService(dir); await restored.init(); assert.equal(restored.state.conversations[0].messages.at(-1).content, answer.content);
  report.tests.push({ name: 'Conversation persistence across restart', passed: true });
  report.status = 'passed';
} catch (e) { report.status = 'failed'; report.error = e.stack; process.exitCode = 1; }
finally { await service.shutdown(); await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/live-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
