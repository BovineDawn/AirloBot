import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AirloService, MODEL } from '../electron/core.mjs';
const dir = path.resolve('test-results/long-response-' + Date.now());
const service = new AirloService(dir, () => {}, { importModels: false });
const report = { startedAt: new Date().toISOString(), model: MODEL, endpoint: 'http://127.0.0.1:1234', maxTokens: -1, offline: true };
let timeout;
try {
  await service.init(); await service.loadModel(MODEL);
  await service.settings({ offline: true, maxTokens: -1, temperature: 0.2 });
  const id = await service.newConversation();
  timeout = setTimeout(() => service.stopChat(), 240000);
  await service.send({ conversationId: id, content: 'Write a detailed beginner guide to organizing a fictional local notes application. Use exactly 24 numbered sections, each with at least 70 words of explanatory prose. Discuss navigation, searching, folders, editing, accessibility, keyboard controls, testing, and backups. Do not abbreviate the guide or stop before section 24. This is a writing exercise, not a request to access real files.' });
  await service.chatPromise;
  const answer = service.state.conversations[0].messages.at(-1);
  Object.assign(report, { status: answer.status, finishReason: answer.finishReason, elapsedMs: answer.elapsedMs, usage: answer.usage, characters: answer.content.length, responseLimit: answer.responseLimit });
  assert.equal(answer.status, 'complete'); assert.equal(answer.responseLimit, -1);
  assert.ok(answer.usage?.completion_tokens > 1024, 'Expected a real reply beyond the former 1024-token cap.');
  const restored = new AirloService(dir); await restored.init();
  assert.equal(restored.state.conversations[0].messages.at(-1).content, answer.content);
  report.passed = true;
} catch (e) { report.passed = false; report.error = e.message; process.exitCode = 1; }
finally {
  clearTimeout(timeout); await service.shutdown();
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/long-response-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
