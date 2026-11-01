import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

export const MODEL = 'gemma-4-e4b-uncensored-hauhaucs-aggressive';
export const LOCAL_ORIGIN = 'http://127.0.0.1:1234';
export const DEFAULT_SETTINGS = {
  model: MODEL, temperature: 0.65, maxTokens: 1024, offline: false,
  systemPrompt: 'You are CrocBot, a helpful assistant running locally on this computer. Be clear, practical, and honest about uncertainty. You have no web access or computer tools. Do not claim to perform actions you cannot perform.'
};
const now = () => new Date().toISOString();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export const cleanError = error => String(error?.message || error).slice(0, 1500);

export function validateRepo(repo) {
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split('/').some(p => p === '.' || p === '..')) throw new Error('Use a Hugging Face repository in publisher/model format.');
  return repo;
}
export function safeModelPath(root, repo, filename) {
  validateRepo(repo);
  if (typeof filename !== 'string' || !/\.gguf$/i.test(filename) || filename.includes('\\') || filename.includes(':') || filename.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Choose a valid GGUF model file.');
  const destination = path.resolve(root, repo, filename);
  if (!destination.startsWith(path.resolve(root) + path.sep)) throw new Error('Model path is outside the library.');
  return destination;
}
export function isHubURL(value) {
  const u = new URL(value);
  return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
    (u.hostname === 'huggingface.co' || u.hostname.endsWith('.huggingface.co') || u.hostname === 'hf.co' || u.hostname.endsWith('.hf.co'));
}
export async function hubFetch(url, options = {}) {
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!isHubURL(url)) throw new Error('Model requests are restricted to Hugging Face download hosts.');
    const response = await fetch(url, { ...options, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new Error('Download redirect is missing a destination.');
      url = new URL(next, url).href;
      continue;
    }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'This repository requires Hugging Face access. This first version supports public, ungated GGUF downloads.'
      : `Hugging Face returned ${response.status}. Try again shortly.`);
    return response;
  }
  throw new Error('Too many download redirects.');
}
export async function localFetch(route, options = {}) {
  if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Invalid local API path.');
  const response = await fetch(LOCAL_ORIGIN + route, {
    ...options, redirect: 'error', headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (!response.ok) {
    const body = await response.text();
    let detail = body.slice(0, 700);
    try { const j = JSON.parse(body); detail = j.error?.message || j.error || j.message || detail; } catch {}
    throw new Error(`Local model service (${response.status}): ${detail}`);
  }
  return response;
}
export async function* sseJSON(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trimEnd(); buffer = buffer.slice(at + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      if (data) yield JSON.parse(data);
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith('data:') && buffer.slice(5).trim() !== '[DONE]') yield JSON.parse(buffer.slice(5).trim());
}

export class CrocService {
  constructor(dataDir, emit = () => {}, options = {}) {
    this.dataDir = dataDir; this.emit = emit; this.options = options;
    this.modelDir = path.join(dataDir, 'models');
    this.lmsPath = options.lmsPath || path.join(os.homedir(), '.lmstudio', 'bin', 'lms.exe');
    this.state = { version: 1, settings: { ...DEFAULT_SETTINGS }, conversations: [], downloads: [] };
    this.downloadJobs = new Map(); this.activeChat = null; this.saveChain = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.modelDir, { recursive: true });
    try { this.state = { ...this.state, ...JSON.parse(await fs.readFile(path.join(this.dataDir, 'state.json'), 'utf8')) }; }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('CrocBot could not read saved data. It has not overwritten it. ' + cleanError(e)); }
    this.state.settings = { ...DEFAULT_SETTINGS, ...this.state.settings };
    for (const c of this.state.conversations) for (const m of c.messages) if (m.status === 'streaming') m.status = 'interrupted';
    for (const d of this.state.downloads) if (['downloading', 'verifying', 'importing'].includes(d.status)) d.status = 'paused';
    await this.save(); return this.snapshot();
  }
  snapshot() { return structuredClone({ ...this.state, dataDir: this.dataDir, modelDir: this.modelDir, endpoint: LOCAL_ORIGIN, activeChat: this.activeChat?.conversationId || null }); }
  save() {
    const content = JSON.stringify(this.state, null, 2);
    const write = async () => {
      const file = path.join(this.dataDir, 'state.json');
      await fs.writeFile(file + '.tmp', content, 'utf8'); await fs.rename(file + '.tmp', file);
    };
    this.saveChain = this.saveChain.then(write, write); return this.saveChain;
  }
  changed() { this.emit({ type: 'state', state: this.snapshot() }); }
  async settings(patch) {
    const s = this.state.settings;
    if (patch.model !== undefined) { if (typeof patch.model !== 'string' || patch.model.length > 300) throw new Error('Invalid model.'); s.model = patch.model; }
    if (patch.temperature !== undefined) { if (!Number.isFinite(patch.temperature) || patch.temperature < 0 || patch.temperature > 2) throw new Error('Temperature must be between 0 and 2.'); s.temperature = patch.temperature; }
    if (patch.maxTokens !== undefined) { if (!Number.isInteger(patch.maxTokens) || patch.maxTokens < 64 || patch.maxTokens > 4096) throw new Error('Response length must be 64–4096 tokens.'); s.maxTokens = patch.maxTokens; }
    if (patch.systemPrompt !== undefined) { if (typeof patch.systemPrompt !== 'string' || patch.systemPrompt.length > 12000) throw new Error('Instructions are too long.'); s.systemPrompt = patch.systemPrompt; }
    if (patch.offline !== undefined) {
      if (typeof patch.offline !== 'boolean') throw new Error('Invalid offline setting.');
      s.offline = patch.offline;
      if (s.offline) for (const job of this.downloadJobs.values()) job.abort();
    }
    await this.save(); this.changed(); return this.snapshot();
  }
  async status() {
    try {
      const data = await (await localFetch('/api/v1/models', { signal: AbortSignal.timeout(5000) })).json();
      const models = data.models.filter(m => m.type === 'llm');
      return { connected: true, endpoint: LOCAL_ORIGIN, models, loaded: models.filter(m => m.loaded_instances?.length) };
    } catch (e) { return { connected: false, endpoint: LOCAL_ORIGIN, models: [], loaded: [], error: cleanError(e) }; }
  }
  runLms(args, timeout = 45000) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.lmsPath, args, { windowsHide: true, shell: false, env: { ...process.env, LMS_SERVER_HOST: '127.0.0.1' } });
      let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('The local runtime did not respond in time.')); }, timeout);
      child.stdout.on('data', b => { output = (output + b).slice(-8000); });
      child.stderr.on('data', b => { output = (output + b).slice(-8000); });
      child.on('error', e => { clearTimeout(timer); reject(new Error('Could not start LM Studio: ' + cleanError(e))); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(output.trim() || `Local runtime exited with code ${code}.`)); });
    });
  }
  async startRuntime() {
    if ((await this.status()).connected) return this.status();
    await this.runLms(['server', 'start', '--bind', '127.0.0.1', '--port', '1234']);
    for (let i = 0; i < 12; i++) { const status = await this.status(); if (status.connected) return status; await wait(500); }
    throw new Error('The local server started but is not responding on port 1234.');
  }
  async loadModel(key) {
    if (this.activeChat) throw new Error('Stop the current response before changing models.');
    const status = await this.startRuntime();
    const model = status.models.find(m => m.key === key);
    if (!model) throw new Error('This model is not installed in the local runtime.');
    if (!model.loaded_instances?.length) {
      await localFetch('/api/v1/models/load', { method: 'POST', body: JSON.stringify({ model: key, context_length: Math.min(8192, model.max_context_length || 8192), flash_attention: true }), signal: AbortSignal.timeout(180000) });
    }
    await this.settings({ model: key }); return this.status();
  }
  async unloadModel(key) {
    if (this.activeChat) throw new Error('Stop the current response first.');
    const status = await this.status(); const m = status.models.find(m => m.key === key);
    for (const instance of m?.loaded_instances || []) await localFetch('/api/v1/models/unload', { method: 'POST', body: JSON.stringify({ instance_id: instance.id }), signal: AbortSignal.timeout(30000) });
    return this.status();
  }
  async newConversation() {
    const c = { id: randomUUID(), title: 'New conversation', createdAt: now(), updatedAt: now(), messages: [] };
    this.state.conversations.unshift(c); await this.save(); this.changed(); return c.id;
  }
  async deleteConversation(id) {
    if (this.activeChat?.conversationId === id) throw new Error('Stop the response before deleting this chat.');
    this.state.conversations = this.state.conversations.filter(c => c.id !== id); await this.save(); this.changed();
  }
  async send({ conversationId, content }) {
    if (this.activeChat) throw new Error('A response is already running. Stop it or wait for it to finish.');
    if (typeof content !== 'string' || !content.trim() || content.length > 24000) throw new Error('Enter a message under 24,000 characters.');
    const c = this.state.conversations.find(c => c.id === conversationId);
    if (!c) throw new Error('Conversation not found.');
    const controller = new AbortController();
    this.activeChat = { conversationId, controller };
    if (!c.messages.length) c.title = content.trim().slice(0, 48);
    c.messages.push({ id: randomUUID(), role: 'user', content: content.trim(), createdAt: now(), status: 'complete' });
    const answer = { id: randomUUID(), role: 'assistant', content: '', reasoning: '', createdAt: now(), status: 'streaming', model: this.state.settings.model };
    c.messages.push(answer); c.updatedAt = now();
    await this.save(); this.changed();
    this.generate(c, answer, controller).catch(e => this.emit({ type: 'error', message: cleanError(e) }));
    return answer.id;
  }
  async generate(c, answer, controller) {
    const started = Date.now();
    try {
      // This one fixed loopback origin is the only destination of conversation data.
      const history = c.messages.filter(m => m.id !== answer.id && m.content && ['complete', 'stopped'].includes(m.status)).slice(-16).map(m => ({ role: m.role, content: m.content }));
      const totalChars = history.reduce((n, m) => n + m.content.length, 0);
      if (totalChars > 24000) throw new Error('This conversation exceeds the starter context budget. Start a new chat or shorten the message.');
      const s = { ...this.state.settings };
      const response = await localFetch('/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ model: s.model, messages: [{ role: 'system', content: s.systemPrompt }, ...history], stream: true, stream_options: { include_usage: true }, temperature: s.temperature, max_tokens: s.maxTokens, reasoning: { enabled: false } })
      });
      let lastEmit = 0;
      for await (const event of sseJSON(response.body)) {
        if (event.error) throw new Error(event.error.message || String(event.error));
        const delta = event.choices?.[0]?.delta;
        if (delta?.content) answer.content += delta.content;
        if (delta?.reasoning_content || delta?.reasoning) answer.reasoning += delta.reasoning_content || delta.reasoning;
        if (event.usage) answer.usage = event.usage;
        if (event.choices?.[0]?.finish_reason) answer.finishReason = event.choices[0].finish_reason;
        if (Date.now() - lastEmit > 45) { this.emit({ type: 'token', conversationId: c.id, message: { ...answer } }); lastEmit = Date.now(); }
      }
      answer.status = 'complete';
      if (!answer.content) { answer.status = 'failed'; answer.error = 'The model returned no answer. Try a shorter prompt or increase response tokens.'; }
    } catch (e) { answer.status = controller.signal.aborted ? 'stopped' : 'failed'; if (!controller.signal.aborted) answer.error = cleanError(e); }
    finally { answer.elapsedMs = Date.now() - started; c.updatedAt = now(); this.activeChat = null; await this.save(); this.changed(); }
  }
  stopChat() { this.activeChat?.controller.abort(); }
  requireOnline() { if (this.state.settings.offline) throw new Error('Offline mode is on. Disable it to browse or download from Hugging Face. Chat remains local in either mode.'); }
  async searchModels(query) {
    this.requireOnline();
    if (typeof query !== 'string' || query.length > 150) throw new Error('Search is too long.');
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query.trim())}&filter=gguf&sort=downloads&direction=-1&limit=18`;
    const data = await (await hubFetch(url, { signal: AbortSignal.timeout(20000) })).json();
    return data.map(m => ({ id: m.id, downloads: m.downloads, likes: m.likes, gated: m.gated, tags: m.tags || [] }));
  }
  async modelFiles(repo) {
    this.requireOnline(); validateRepo(repo);
    const data = await (await hubFetch(`https://huggingface.co/api/models/${repo}?blobs=true`, { signal: AbortSignal.timeout(20000) })).json();
    return { repo: data.id, revision: data.sha, license: data.cardData?.license || (data.tags || []).find(t => t.startsWith('license:'))?.slice(8) || 'See model card',
      files: (data.siblings || []).filter(f => /\.gguf$/i.test(f.rfilename)).map(f => ({ name: f.rfilename, size: f.size || f.lfs?.size || 0, sha256: f.lfs?.sha256 || null, projector: /mmproj/i.test(f.rfilename), split: /-\d{5}-of-\d{5}\.gguf$/i.test(f.rfilename) })) };
  }
  async startDownload({ repo, filename }) {
    this.requireOnline(); safeModelPath(this.modelDir, repo, filename);
    if (this.downloadJobs.size) throw new Error('Pause the current download or wait for it to finish.');
    const existing = this.state.downloads.find(d => d.repo === repo && d.filename === filename);
    if (existing) { if (existing.status === 'complete') throw new Error('This model is already downloaded.'); return this.resumeDownload(existing.id); }
    const info = await this.modelFiles(repo); const file = info.files.find(f => f.name === filename);
    if (!file || !file.size || !file.sha256) throw new Error('This file lacks verifiable size/SHA-256 metadata.');
    if (file.split) throw new Error('Split GGUF downloads are not supported in this first version. Choose a single-file quantization.');
    const d = { id: randomUUID(), repo, filename, revision: info.revision, size: file.size, sha256: file.sha256, received: 0, status: 'paused', createdAt: now(), projector: file.projector };
    this.state.downloads.unshift(d); await this.save(); return this.resumeDownload(d.id);
  }
  async resumeDownload(id) {
    this.requireOnline();
    if (this.downloadJobs.size) throw new Error('Another download is already running.');
    const d = this.state.downloads.find(d => d.id === id);
    if (!d || d.status === 'complete') throw new Error('Download is not resumable.');
    const controller = new AbortController(); this.downloadJobs.set(id, controller);
    d.status = 'downloading'; d.error = null; await this.save(); this.changed();
    this.download(d, controller).catch(e => this.emit({ type: 'error', message: cleanError(e) }));
    return id;
  }
  pauseDownload(id) { this.downloadJobs.get(id)?.abort(); }
  async download(d, controller) {
    const destination = safeModelPath(this.modelDir, d.repo, d.filename);
    const partial = destination + '.part';
    let writer;
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // Existing final files are verified and imported, never overwritten.
      let completeFile = false;
      try { await fs.stat(destination); completeFile = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!completeFile) {
        let offset = await fs.stat(partial).then(s => s.size).catch(() => 0);
        if (offset > d.size) throw new Error('Partial file is larger than the model. Remove the .part file before retrying.');
        const disk = await fs.statfs(path.dirname(destination));
        if (disk.bavail * disk.bsize < d.size - offset + 64 * 1024 * 1024) throw new Error('Not enough free disk space for this model.');
        if (offset < d.size) {
          const url = `https://huggingface.co/${d.repo}/resolve/${d.revision}/${d.filename.split('/').map(encodeURIComponent).join('/')}?download=true`;
          const response = await hubFetch(url, { signal: controller.signal, headers: offset ? { Range: `bytes=${offset}-` } : {} });
          if (offset && response.status === 200) offset = 0;
          if (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw new Error('The server returned an incorrect resume range.');
          writer = createWriteStream(partial, { flags: offset ? 'a' : 'w' });
          // Attach error handling immediately, including errors before backpressure.
          let writeError; writer.on('error', e => { writeError = e; });
          d.received = offset; let lastEmit = 0; let lastSave = Date.now();
          for await (const chunk of response.body) {
            if (controller.signal.aborted) throw new Error('Paused');
            if (writeError) throw writeError;
            if (d.received + chunk.length > d.size) throw new Error('Download exceeds its declared size.');
            if (!writer.write(chunk)) await once(writer, 'drain');
            d.received += chunk.length;
            if (Date.now() - lastEmit > 200) { this.emit({ type: 'download', download: { ...d } }); lastEmit = Date.now(); }
            if (Date.now() - lastSave > 5000) { await this.save(); lastSave = Date.now(); }
          }
          writer.end(); await once(writer, 'finish'); writer = null;
        }
      }
      if (controller.signal.aborted) throw new Error('Paused');
      d.status = 'verifying'; this.changed();
      const file = completeFile ? destination : partial;
      const stat = await fs.stat(file);
      if (stat.size !== d.size) throw new Error('Download is incomplete. Resume to finish it.');
      const hash = createHash('sha256'); let magic = null;
      for await (const chunk of createReadStream(file)) { if (!magic) magic = chunk.subarray(0, 4).toString('ascii'); if (controller.signal.aborted) throw new Error('Paused'); hash.update(chunk); }
      if (magic !== 'GGUF' || hash.digest('hex') !== d.sha256) throw new Error('Model integrity check failed. The file was not imported.');
      if (!completeFile) await fs.rename(partial, destination);
      d.received = d.size; d.status = 'importing'; this.changed();
      if (!d.projector && this.options.importModels !== false) {
        try { await this.runLms(['import', destination, '--hard-link', '--user-repo', d.repo, '--yes'], 60000); d.imported = true; }
        catch (e) { d.imported = false; d.importError = cleanError(e); }
      }
      d.path = destination; d.status = 'complete'; d.completedAt = now();
    } catch (e) { d.status = controller.signal.aborted ? 'paused' : 'failed'; d.error = controller.signal.aborted ? null : cleanError(e); }
    finally { if (writer) { writer.destroy(); if (!writer.closed) await once(writer, 'close').catch(() => {}); } this.downloadJobs.delete(d.id); await this.save(); this.changed(); }
  }
  async retryImport(id) {
    const d = this.state.downloads.find(d => d.id === id && d.status === 'complete');
    if (!d || d.projector) throw new Error('No importable model found.');
    await this.runLms(['import', safeModelPath(this.modelDir, d.repo, d.filename), '--hard-link', '--user-repo', d.repo, '--yes'], 60000);
    d.imported = true; d.importError = null; await this.save(); this.changed();
  }
  async shutdown() { this.stopChat(); for (const job of this.downloadJobs.values()) job.abort(); await this.save(); }
}
