import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ProjectFiles } from './project.mjs';
import { AgentRunner, makeTask } from './agents.mjs';
import { chatContext, validResponseLimit } from './chat-context.mjs';
import { DEFAULT_TASK_BUDGET, TaskLimitError, validTaskTurns, validTaskMinutes } from './task-budget.mjs';

export const MODEL = 'gemma-4-e4b-uncensored-hauhaucs-aggressive';
export const LOCAL_ORIGIN = 'http://127.0.0.1:1234';
export const DEFAULT_SETTINGS = {
  model: MODEL, temperature: 0.65, maxTokens: -1, offline: false,
  theme: 'dark', glassIntensity: 60, reducedMotion: false, reducedTransparency: false,
  taskMaxTurns: DEFAULT_TASK_BUDGET.maxTurns, taskMaxMinutes: DEFAULT_TASK_BUDGET.maxMinutes,
  systemPrompt: 'You are AirloBot, a helpful assistant running locally on this computer. Be clear, practical, and honest about uncertainty. You have no web access or computer tools. Do not claim to perform actions you cannot perform.'
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

export class AirloService {
  constructor(dataDir, emit = () => {}, options = {}) {
    this.dataDir = dataDir; this.emit = emit; this.options = options;
    this.modelDir = path.join(dataDir, 'models');
    this.lmsPath = options.lmsPath || path.join(os.homedir(), '.lmstudio', 'bin', 'lms.exe');
    this.state = { version: 3, settings: { ...DEFAULT_SETTINGS }, conversations: [], downloads: [], project: null, tasks: [], workspace: { selected: 'new:task', sidebarCollapsed: false, drafts: {} } };
    this.downloadJobs = new Map(); this.activeChat = null; this.saveChain = Promise.resolve();
    this.activeTask = null; this.agentPromise = null; this.chatPromise = null; this.reviewing = false;
  }
  async init() {
    await fs.mkdir(this.modelDir, { recursive: true });
    try { this.state = { ...this.state, ...JSON.parse(await fs.readFile(path.join(this.dataDir, 'state.json'), 'utf8')) }; }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('AirloBot could not read saved data. It has not overwritten it. ' + cleanError(e)); }
    const oldVersion = this.state.version;
    this.state.settings = { ...DEFAULT_SETTINGS, ...this.state.settings };
    this.state.version = 3;
    // Retain custom caps; the former stock cap truncated ordinary answers.
    if (oldVersion < 3 && this.state.settings.maxTokens === 1024) this.state.settings.maxTokens = -1;
    if (!validResponseLimit(this.state.settings.maxTokens)) this.state.settings.maxTokens = DEFAULT_SETTINGS.maxTokens;
    if (!validTaskTurns(this.state.settings.taskMaxTurns)) this.state.settings.taskMaxTurns = DEFAULT_SETTINGS.taskMaxTurns;
    if (!validTaskMinutes(this.state.settings.taskMaxMinutes)) this.state.settings.taskMaxMinutes = DEFAULT_SETTINGS.taskMaxMinutes;
    this.state.workspace = { selected: 'new:task', sidebarCollapsed: false, drafts: {}, ...this.state.workspace };
    this.state.workspace.drafts ||= {};
    this.state.tasks ||= [];
    for (const task of this.state.tasks) {
      if (task.status === 'running') { task.status = 'interrupted'; task.error = 'AirloBot closed during this task. Run it again to start a fresh attempt.'; }
      for (const agent of task.agents) if (['running', 'waiting'].includes(agent.status)) agent.status = 'interrupted';
      for (const proposal of task.proposals) if (proposal.status === 'applying') { proposal.status = 'uncertain'; proposal.error = 'Interrupted while applying. Inspect the file before proposing another change.'; }
    }
    // Update only the former stock identity; never rewrite a user's instructions.
    if (this.state.settings.systemPrompt === DEFAULT_SETTINGS.systemPrompt.replace('AirloBot', 'CrocBot')) this.state.settings.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
    if (!['light', 'dark', 'glass'].includes(this.state.settings.theme)) this.state.settings.theme = 'dark';
    if (!Number.isInteger(this.state.settings.glassIntensity) || this.state.settings.glassIntensity < 20 || this.state.settings.glassIntensity > 90) this.state.settings.glassIntensity = 60;
    if (typeof this.state.settings.reducedMotion !== 'boolean') this.state.settings.reducedMotion = false;
    if (typeof this.state.settings.reducedTransparency !== 'boolean') this.state.settings.reducedTransparency = false;
    for (const c of this.state.conversations) for (const m of c.messages) if (m.status === 'streaming') m.status = 'interrupted';
    for (const d of this.state.downloads) if (['downloading', 'verifying', 'importing'].includes(d.status)) d.status = 'paused';
    await this.save(); return this.snapshot();
  }
  snapshot() { return structuredClone({ ...this.state, dataDir: this.dataDir, modelDir: this.modelDir, endpoint: LOCAL_ORIGIN, activeChat: this.activeChat?.conversationId || null, activeTask: this.activeTask?.id || null, reviewing: this.reviewing }); }
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
    if (patch.model !== undefined && (this.activeTask || this.activeChat)) throw new Error('Stop the current work before changing models.');
    const s = { ...this.state.settings };
    if (patch.theme !== undefined) { if (!['light', 'dark', 'glass'].includes(patch.theme)) throw new Error('Choose Light, Dark, or Liquid Glass.'); s.theme = patch.theme; }
    if (patch.glassIntensity !== undefined) { if (!Number.isInteger(patch.glassIntensity) || patch.glassIntensity < 20 || patch.glassIntensity > 90) throw new Error('Glass intensity must be 20–90.'); s.glassIntensity = patch.glassIntensity; }
    if (patch.reducedMotion !== undefined) { if (typeof patch.reducedMotion !== 'boolean') throw new Error('Invalid motion setting.'); s.reducedMotion = patch.reducedMotion; }
    if (patch.reducedTransparency !== undefined) { if (typeof patch.reducedTransparency !== 'boolean') throw new Error('Invalid transparency setting.'); s.reducedTransparency = patch.reducedTransparency; }
    if (patch.model !== undefined) { if (typeof patch.model !== 'string' || patch.model.length > 300) throw new Error('Invalid model.'); s.model = patch.model; }
    if (patch.temperature !== undefined) { if (!Number.isFinite(patch.temperature) || patch.temperature < 0 || patch.temperature > 2) throw new Error('Temperature must be between 0 and 2.'); s.temperature = patch.temperature; }
    if (patch.maxTokens !== undefined) { if (!validResponseLimit(patch.maxTokens)) throw new Error('Choose unlimited (-1) or 64–32768 response tokens.'); s.maxTokens = patch.maxTokens; }
    if (patch.taskMaxTurns !== undefined) { if (!validTaskTurns(patch.taskMaxTurns)) throw new Error('Choose unlimited (-1) or 10–1000 task model turns.'); s.taskMaxTurns = patch.taskMaxTurns; }
    if (patch.taskMaxMinutes !== undefined) { if (!validTaskMinutes(patch.taskMaxMinutes)) throw new Error('Choose no time limit (-1) or 1–1440 minutes.'); s.taskMaxMinutes = patch.taskMaxMinutes; }
    if (patch.systemPrompt !== undefined) { if (typeof patch.systemPrompt !== 'string' || patch.systemPrompt.length > 12000) throw new Error('Instructions are too long.'); s.systemPrompt = patch.systemPrompt; }
    if (patch.offline !== undefined) {
      if (typeof patch.offline !== 'boolean') throw new Error('Invalid offline setting.');
      s.offline = patch.offline;
      if (s.offline) for (const job of this.downloadJobs.values()) job.abort();
    }
    this.state.settings = s;
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
    if (this.activeChat || this.activeTask) throw new Error('Stop the current work before changing models.');
    const status = await this.startRuntime();
    const model = status.models.find(m => m.key === key);
    if (!model) throw new Error('This model is not installed in the local runtime.');
    if (!model.loaded_instances?.length) {
      await localFetch('/api/v1/models/load', { method: 'POST', body: JSON.stringify({ model: key, context_length: Math.min(8192, model.max_context_length || 8192), flash_attention: true }), signal: AbortSignal.timeout(180000) });
    }
    await this.settings({ model: key }); return this.status();
  }
  async unloadModel(key) {
    if (this.activeChat || this.activeTask) throw new Error('Stop the current work first.');
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
    this.state.conversations = this.state.conversations.filter(c => c.id !== id);
    delete this.state.workspace.drafts['chat:' + id];
    if (this.state.workspace.selected === 'chat:' + id) this.state.workspace.selected = 'new:chat';
    await this.save(); this.changed();
  }
  async workspace(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !['selected', 'sidebarCollapsed', 'draft'].includes(k))) throw new Error('Invalid workspace preference.');
    const validKey = key => ['new:chat', 'new:task'].includes(key) || (typeof key === 'string' && (this.state.conversations.some(c => key === 'chat:' + c.id) || this.state.tasks.some(t => key === 'task:' + t.id)));
    const next = structuredClone(this.state.workspace);
    if (patch.selected !== undefined) { if (!validKey(patch.selected)) throw new Error('Work item not found.'); next.selected = patch.selected; }
    if (patch.sidebarCollapsed !== undefined) { if (typeof patch.sidebarCollapsed !== 'boolean') throw new Error('Invalid sidebar preference.'); next.sidebarCollapsed = patch.sidebarCollapsed; }
    if (patch.draft !== undefined) {
      const d = patch.draft;
      if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some(k => !['key', 'text'].includes(k)) || !validKey(d.key) || typeof d.text !== 'string' || d.text.length > (d.key === 'new:chat' || d.key.startsWith('chat:') ? 24000 : 4000)) throw new Error('Invalid local draft.');
      if (d.text) next.drafts[d.key] = d.text; else delete next.drafts[d.key];
      if (Object.keys(next.drafts).length > 200) throw new Error('There are 200 saved drafts. Clear an old draft before adding another.');
    }
    this.state.workspace = next;
    await this.save(); return structuredClone(next);
  }
  async send({ conversationId, content }) {
    if (this.activeTask) throw new Error('Wait for the project task or stop it before starting a chat response.');
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
    this.chatPromise = this.generate(c, answer, controller).catch(e => this.emit({ type: 'error', message: cleanError(e) }));
    return answer.id;
  }
  async generate(c, answer, controller) {
    const started = Date.now();
    try {
      // This one fixed loopback origin is the only destination of conversation data.
      const s = { ...this.state.settings };
      const context = chatContext(c, answer.id, s.systemPrompt);
      answer.omittedMessages = context.omitted;
      answer.responseLimit = s.maxTokens;
      const response = await localFetch('/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ model: s.model, messages: context.messages, stream: true, stream_options: { include_usage: true }, temperature: s.temperature, max_tokens: s.maxTokens, reasoning: { enabled: false } })
      });
      let lastEmit = 0;
      for await (const event of sseJSON(response.body)) {
        if (event.error) throw new Error(event.error.message || String(event.error));
        const delta = event.choices?.[0]?.delta;
        if (delta?.content) answer.content += delta.content;
        if (delta?.reasoning_content || delta?.reasoning) answer.reasoning += delta.reasoning_content || delta.reasoning;
        if (answer.content.length + answer.reasoning.length > 2000000) { answer.error = 'Response reached the local display/storage limit.'; controller.abort(); throw new Error(answer.error); }
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
  async selectProject(root) {
    if (this.activeTask || this.reviewing) throw new Error('Stop the task before changing projects.');
    const files = await ProjectFiles.open(root);
    if (this.activeTask || this.reviewing) throw new Error('Stop the task before changing projects.');
    this.state.project = { name: path.basename(files.root), path: files.root };
    await this.save(); this.changed(); return this.snapshot();
  }
  async startTask({ goal }) {
    if (this.activeTask || this.activeChat || this.reviewing) throw new Error('Wait for the current work or stop it first.');
    if (!this.state.project) throw new Error('Choose a project folder first.');
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) throw new Error('Enter a task of 1–4000 characters.');
    const task = makeTask(goal.trim(), this.state.project, this.state.settings.model, { maxTurns: this.state.settings.taskMaxTurns, maxMinutes: this.state.settings.taskMaxMinutes });
    const controller = new AbortController();
    this.activeTask = { id: task.id, controller };
    this.state.tasks.unshift(task);
    const timer = task.budget.maxMinutes === -1 ? null : setTimeout(() => controller.abort(new TaskLimitError(`Task reached its ${task.budget.maxMinutes}-minute time limit. Increase the Project tasks budget in Settings to allow longer work.`)), task.budget.maxMinutes * 60000);
    const runner = new AgentRunner(task, {
      signal: controller.signal,
      changed: async () => { await this.save(); this.changed(); },
      request: this.options.agentRequest || (async (body, signal) => (await localFetch('/v1/chat/completions', {
        method: 'POST', body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(120000)])
      })).json())
    });
    try { await this.save(); this.changed(); }
    catch (error) { clearTimeout(timer); this.activeTask = null; task.status = 'failed'; throw error; }
    this.agentPromise = runner.run().catch(error => { task.status = 'failed'; task.error = cleanError(error); }).finally(async () => {
      clearTimeout(timer); this.activeTask = null; await this.save(); this.changed();
    });
    return task.id;
  }
  stopTask(id) { if (id !== this.activeTask?.id) throw new Error('That task is not running.'); this.activeTask.controller.abort(); }
  async deleteTask(id) {
    if (typeof id !== 'string' || !this.state.tasks.some(t => t.id === id)) throw new Error('Task not found.');
    if (this.activeTask?.id === id || this.reviewing) throw new Error('Stop this task and finish the file review before deleting it.');
    this.state.tasks = this.state.tasks.filter(t => t.id !== id);
    delete this.state.workspace.drafts['task:' + id];
    if (this.state.workspace.selected === 'task:' + id) this.state.workspace.selected = 'new:task';
    await this.save(); this.changed();
  }
  async reviewChange({ taskId, proposalId, decision }) {
    if (this.activeTask || this.reviewing) throw new Error('Wait for the task or current file review to finish.');
    if (!['apply', 'reject'].includes(decision)) throw new Error('Invalid review decision.');
    const task = this.state.tasks.find(t => t.id === taskId), proposal = task?.proposals.find(p => p.id === proposalId);
    if (!proposal || proposal.status !== 'pending') throw new Error('This proposal is no longer awaiting review.');
    if (task.project.path !== this.state.project?.path) throw new Error('Select this task’s project folder before reviewing its changes.');
    this.reviewing = true;
    try {
      if (decision === 'reject') proposal.status = 'rejected';
      else {
        const files = await ProjectFiles.open(task.project.path);
        if (files.root !== task.project.path) throw new Error('Project location changed. Select it again.');
        proposal.status = 'applying'; await this.save(); this.changed();
        try { proposal.appliedHash = await files.apply(proposal); proposal.status = 'applied'; proposal.appliedAt = now(); delete proposal.error; }
        catch (error) { proposal.status = 'pending'; proposal.error = cleanError(error); throw error; }
      }
    } finally { this.reviewing = false; await this.save(); this.changed(); }
    return this.snapshot();
  }
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
  async shutdown() { this.stopChat(); this.activeTask?.controller.abort(); for (const job of this.downloadJobs.values()) job.abort(); await Promise.all([this.agentPromise, this.chatPromise]); await this.save(); }
}
