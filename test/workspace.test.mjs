import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AirloService } from '../electron/core.mjs';
import { chatContext, validResponseLimit } from '../electron/chat-context.mjs';

async function fixture(t) {
  const root = path.resolve('test-results/unit');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'workspace-'));
  const s = new AirloService(dir, () => {}, { importModels: false });
  t.after(async () => { await s.shutdown(); assert.ok(dir.startsWith(root + path.sep)); await fs.rm(dir, { recursive: true, force: true }); });
  await s.init(); return s;
}
test('response caps accept unlimited and large budgets, reject malformed values atomically', async t => {
  const s = await fixture(t);
  for (const maxTokens of [-1, 64, 1024, 8192, 32768]) {
    assert.equal(validResponseLimit(maxTokens), true);
    await s.settings({ maxTokens });
  }
  for (const maxTokens of [0, -2, 63, 32769, 1.5, NaN, Infinity, '8192', null]) {
    await assert.rejects(s.settings({ maxTokens, temperature: 0.1 }));
    assert.equal(s.state.settings.maxTokens, 32768);
    assert.equal(s.state.settings.temperature, 0.65);
  }
  await s.settings({ maxTokens: -1 });
  const restored = new AirloService(s.dataDir); await restored.init();
  assert.equal(restored.state.settings.maxTokens, -1);
});
test('migration preserves content and custom caps, replacing only the former stock cap and themes', async t => {
  const s = await fixture(t); const id = await s.newConversation();
  s.state.conversations[0].messages.push({ id: 'saved', role: 'user', content: 'Preserve this', status: 'complete' });
  for (const [cap, theme, expectedCap, expectedTheme] of [[1024, 'graphite', -1, 'dark'], [4096, 'midnight', 4096, 'dark'], [8192, 'glass', 8192, 'glass']]) {
    s.state.version = 2; s.state.settings.maxTokens = cap; s.state.settings.theme = theme;
    delete s.state.workspace; await s.save();
    const restored = new AirloService(s.dataDir); await restored.init();
    assert.equal(restored.state.settings.maxTokens, expectedCap); assert.equal(restored.state.settings.theme, expectedTheme);
    assert.equal(restored.state.conversations[0].id, id); assert.equal(restored.state.conversations[0].messages[0].content, 'Preserve this');
    assert.deepEqual(restored.state.workspace.drafts, {});
  }
});
test('workspace drafts survive restart and deletion; untrusted workspace patches are rejected atomically', async t => {
  const s = await fixture(t); const id = await s.newConversation(); const key = 'chat:' + id;
  await s.workspace({ selected: key, sidebarCollapsed: true, draft: { key, text: 'Unsent private draft' } });
  const expected = structuredClone(s.state.workspace);
  for (const patch of [null, [], { selected: 'chat:missing' }, { selected: 'new:task', sidebarCollapsed: 'true' }, { draft: { key: '__proto__', text: 'x' } }, { draft: { key: 'new:task', text: 'x'.repeat(4001) } }, { draft: { key, text: 'x'.repeat(24001) } }, { draft: { key, text: 'new', remote: true } }, { arbitrary: true }]) {
    await assert.rejects(s.workspace(patch)); assert.deepEqual(s.state.workspace, expected);
  }
  const restored = new AirloService(s.dataDir); await restored.init();
  assert.deepEqual(restored.state.workspace, expected);
  await restored.deleteConversation(id);
  assert.equal(restored.state.workspace.selected, 'new:chat'); assert.equal(restored.state.workspace.drafts[key], undefined);
});
test('context drops whole oldest turns without mutating saved history or limiting to 16 messages', () => {
  const messages = Array.from({ length: 24 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user', content: String(i).padStart(2, '0'), status: 'complete' }));
  messages.push({ id: 'current', role: 'user', content: 'current', status: 'complete' });
  messages.push({ id: 'answer', role: 'assistant', content: '', status: 'streaming' });
  const original = structuredClone(messages);
  const small = chatContext({ messages }, 'answer', 'system', 21);
  assert.deepEqual(small.messages.map(m => m.content), ['system', '20', '21', '22', '23', 'current']);
  assert.equal(small.omitted, 20);
  const full = chatContext({ messages }, 'answer', 'system');
  assert.equal(full.messages.length, 26); assert.equal(full.omitted, 0);
  assert.deepEqual(messages, original);
  assert.throws(() => chatContext({ messages }, 'answer', 'system', 12), /Shorten/);
});
test('unlimited and large caps reach the local API, preserve truncation reasons, and stop cleanly on shutdown', async t => {
  const s = await fixture(t); const original = global.fetch; t.after(() => { global.fetch = original; });
  let expectedCap = -1;
  global.fetch = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:1234/v1/chat/completions');
    assert.equal(JSON.parse(options.body).max_tokens, expectedCap);
    return new Response('data: {"choices":[{"delta":{"content":"Long reply"},"finish_reason":"length"}],"usage":{"completion_tokens":1500}}\n\ndata: [DONE]\n\n');
  };
  const id = await s.newConversation();
  for (const cap of [-1, 8192]) {
    expectedCap = cap; await s.settings({ maxTokens: cap });
    await s.send({ conversationId: id, content: 'Explain' }); await s.chatPromise;
    const answer = s.state.conversations[0].messages.at(-1);
    assert.equal(answer.status, 'complete'); assert.equal(answer.finishReason, 'length'); assert.equal(answer.responseLimit, cap);
  }
  global.fetch = async (_url, options) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));
    options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
  } }));
  await s.send({ conversationId: id, content: 'Keep going' }); await s.shutdown();
  const restored = new AirloService(s.dataDir); await restored.init();
  assert.equal(restored.state.conversations[0].messages.at(-1).status, 'stopped');
  assert.equal(s.activeChat, null);
});
