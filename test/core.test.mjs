import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AirloService, DEFAULT_SETTINGS, validateRepo, safeModelPath, isHubURL, localFetch, hubFetch, sseJSON } from '../electron/core.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await delay(20); } throw new Error('Timed out'); }
async function fixture(t) {
  const root = path.resolve('test-results/unit');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'case-'));
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(root + path.sep));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const service = new AirloService(dir, () => {}, { importModels: false }); await service.init(); return service;
}

test('GGUF paths cannot escape the library or use Windows alternate streams', () => {
  for (const repo of ['../escape', 'ok/..', 'https://evil/a', 'a/b/c', 'a\\b']) assert.throws(() => validateRepo(repo));
  for (const file of ['../a.gguf', 'a/../../b.gguf', 'C:\\a.gguf', 'a.gguf:evil.gguf', 'a.js', 'a//b.gguf']) assert.throws(() => safeModelPath('models', 'owner/repo', file));
  assert.equal(safeModelPath('models', 'owner/repo', 'nested/a.gguf'), path.resolve('models/owner/repo/nested/a.gguf'));
});
test('Hub redirects stay on HTTPS Hugging Face download hosts', async t => {
  assert.equal(isHubURL('https://cas-bridge.xethub.hf.co/x'), true);
  for (const url of ['https://huggingface.co.evil.com/a', 'http://huggingface.co/a', 'https://127.0.0.1/a', 'https://user:secret@huggingface.co/x']) assert.equal(isHubURL(url), false);
  const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/model' } });
  await assert.rejects(hubFetch('https://huggingface.co/owner/model'), /restricted/);
});
test('inference requests always use a fixed loopback origin and reject redirects', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = async (url, options) => { assert.equal(url, 'http://127.0.0.1:1234/v1/models'); assert.equal(options.redirect, 'error'); return Response.json({ data: [] }); };
  await localFetch('/v1/models');
  await assert.rejects(localFetch('//cloud.example/v1/models'), /Invalid/);
  await assert.rejects(localFetch('https://cloud.example'), /Invalid/);
});
test('SSE handles split UTF-8 tokens, CRLF and done frames', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"airlo 🤖"}\r\n\r\ndata: {"n":2}\n\ndata: [DONE]\n\n');
  const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 2) c.enqueue(bytes.slice(i, i + 2)); c.close(); } });
  const result = []; for await (const item of sseJSON(body)) result.push(item);
  assert.deepEqual(result, [{ text: 'airlo 🤖' }, { n: 2 }]);
});
test('offline mode blocks the model hub, while local state survives restart', async t => {
  const s = await fixture(t); const id = await s.newConversation();
  await s.settings({ offline: true, temperature: 0.3 });
  await assert.rejects(s.searchModels('Gemma'), /Offline/);
  await assert.rejects(s.modelFiles('owner/repo'), /Offline/);
  const restarted = new AirloService(s.dataDir); await restarted.init();
  assert.equal(restarted.state.settings.offline, true); assert.equal(restarted.state.settings.temperature, 0.3);
  assert.equal(restarted.state.conversations[0].id, id);
});

test('appearance survives restart and rejects invalid changes without partial updates', async t => {
  const s = await fixture(t);
  await s.settings({ theme: 'glass', glassIntensity: 82, reducedMotion: true });
  const restarted = new AirloService(s.dataDir); await restarted.init();
  assert.equal(restarted.state.settings.theme, 'glass');
  assert.equal(restarted.state.settings.glassIntensity, 82);
  assert.equal(restarted.state.settings.reducedMotion, true);
  for (const patch of [{ theme: 'remote' }, { theme: 'midnight', glassIntensity: 100 }, { glassIntensity: 50.5 }, { reducedMotion: 'false' }]) await assert.rejects(restarted.settings(patch));
  assert.equal(restarted.state.settings.theme, 'glass');
  assert.equal(restarted.state.settings.glassIntensity, 82);
});

test('rename migrates only the stock identity and preserves conversations and custom instructions', async t => {
  const s = await fixture(t); const id = await s.newConversation();
  s.state.conversations[0].messages.push({ role: 'user', content: 'My CrocBot project', status: 'complete' });
  s.state.settings = { systemPrompt: DEFAULT_SETTINGS.systemPrompt.replace('AirloBot', 'CrocBot') };
  await s.save();
  const migrated = new AirloService(s.dataDir); await migrated.init();
  assert.equal(migrated.state.settings.systemPrompt, DEFAULT_SETTINGS.systemPrompt);
  assert.equal(migrated.state.settings.theme, 'dark');
  assert.equal(migrated.state.conversations[0].id, id);
  assert.equal(migrated.state.conversations[0].messages[0].content, 'My CrocBot project');
  const custom = 'You are CrocBot. Help me with my own project.';
  await migrated.settings({ systemPrompt: custom });
  const restarted = new AirloService(s.dataDir); await restarted.init();
  assert.equal(restarted.state.settings.systemPrompt, custom);
});
test('streaming responses persist, duplicate sends reject, cancellation is recorded', async t => {
  const s = await fixture(t); const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = async (_url, options) => {
    assert.ok(JSON.parse(options.body).messages.some(m => m.content === 'Hello local model'));
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello!"}}]}\n\n'));
      options.signal.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')));
    } }));
  };
  const id = await s.newConversation(); await s.send({ conversationId: id, content: 'Hello local model' });
  await assert.rejects(s.send({ conversationId: id, content: 'duplicate' }), /already running/);
  await until(() => s.state.conversations[0].messages[1].content === 'Hello!');
  s.stopChat(); await until(() => !s.activeChat); await s.saveChain;
  const saved = JSON.parse(await fs.readFile(path.join(s.dataDir, 'state.json')));
  assert.equal(saved.conversations[0].messages[1].status, 'stopped');
  assert.equal(saved.conversations[0].messages[1].content, 'Hello!');
});
test('download resumes a pinned revision, checks bytes and SHA-256, then commits', async t => {
  const s = await fixture(t); const original = global.fetch; t.after(() => { global.fetch = original; });
  const bytes = Buffer.from('GGUF01234567890123456789'); const hash = createHash('sha256').update(bytes).digest('hex');
  const d = { id: 'resume-test', repo: 'owner/repo', filename: 'model.gguf', revision: 'a'.repeat(40), size: bytes.length, sha256: hash, received: 8, status: 'paused' };
  const target = safeModelPath(s.modelDir, d.repo, d.filename); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target + '.part', bytes.subarray(0, 8));
  s.state.downloads.push(d);
  global.fetch = async (url, options) => { assert.ok(url.includes('/' + d.revision + '/')); assert.equal(options.headers.Range, 'bytes=8-'); return new Response(bytes.subarray(8), { status: 206, headers: { 'content-range': `bytes 8-${bytes.length - 1}/${bytes.length}` } }); };
  await s.resumeDownload(d.id); await until(() => !s.downloadJobs.size); await s.saveChain;
  assert.equal(d.status, 'complete'); assert.deepEqual(await fs.readFile(target), bytes);
  await assert.rejects(fs.stat(target + '.part'), { code: 'ENOENT' });
});
test('corrupt downloads never become loadable final models', async t => {
  const s = await fixture(t); const original = global.fetch; t.after(() => { global.fetch = original; });
  const bytes = Buffer.from('GGUFbad-content');
  const d = { id: 'corrupt', repo: 'owner/repo', filename: 'bad.gguf', revision: 'b'.repeat(40), size: bytes.length, sha256: '0'.repeat(64), received: 0, status: 'paused' };
  s.state.downloads.push(d); global.fetch = async () => new Response(bytes);
  await s.resumeDownload(d.id); await until(() => !s.downloadJobs.size); await s.saveChain;
  assert.equal(d.status, 'failed'); assert.match(d.error, /integrity/);
  await assert.rejects(fs.stat(safeModelPath(s.modelDir, d.repo, d.filename)), { code: 'ENOENT' });
});
