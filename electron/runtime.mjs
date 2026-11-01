import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function runtimeEnvironment(secret, source = process.env) {
  const env = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA']) if (source[name]) env[name] = source[name];
  return { ...env, LLAMA_API_KEY: secret };
}
export function runtimeArguments(model, port, settings) {
  return ['--model', model.path, '--alias', model.key, '--host', '127.0.0.1', '--port', String(port),
    '--ctx-size', String(Math.min(settings.contextTokens || 16384, model.max_context_length || 16384)),
    '--parallel', '1', '--n-gpu-layers', settings.acceleration === 'cpu' ? '0' : 'auto',
    '--jinja', '--reasoning', 'off', '--offline', '--no-webui', '--no-agent', '--no-ui-mcp-proxy', '--no-slots',
    '--cors-origins', 'airlobot://app', '--no-cors-credentials', '--log-disable'];
}
async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
export class LocalRuntime {
  constructor({ directory, changed = () => {} } = {}) {
    this.directory = directory || fileURLToPath(new URL('../native/llama/', import.meta.url));
    this.changed = changed; this.child = null; this.modelKey = null; this.origin = null; this.secret = null; this.phase = 'stopped'; this.error = null; this.loading = null;
  }
  async status() {
    const available = await fs.access(path.join(this.directory, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')).then(() => true, () => false);
    return { available, connected: this.phase === 'ready' && !!this.child, phase: this.phase, error: this.error, endpoint: this.origin || 'Managed locally by AirloBot', modelKey: this.modelKey, backend: 'llama.cpp' };
  }
  async load(model, settings) {
    if (this.loading) throw new Error('A model is already loading.');
    if (this.phase === 'ready' && this.modelKey === model.key && this.config === JSON.stringify([settings.contextTokens, settings.acceleration])) return;
    this.loading = this.start(model, settings);
    try { await this.loading; } finally { this.loading = null; }
  }
  async start(model, settings) {
    await this.stop();
    if (!(await this.status()).available) throw new Error('The bundled engine is missing. Reinstall AirloBot, or run npm run runtime:install for a source checkout.');
    await fs.access(model.path);
    const port = await availablePort();
    this.secret = randomBytes(32).toString('hex'); this.origin = `http://127.0.0.1:${port}`;
    this.phase = 'loading'; this.error = null; this.modelKey = model.key;
    const child = spawn(path.join(this.directory, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'), runtimeArguments(model, port, settings), {
      cwd: this.directory, shell: false, windowsHide: true, env: runtimeEnvironment(this.secret), stdio: ['ignore', 'ignore', 'pipe']
    });
    this.child = child;
    // Never write prompts, file contents, request bodies or runtime output to disk.
    child.stderr.on('data', () => {});
    child.on('error', e => { if (this.child === child) { this.error = `Could not start the bundled engine (${e.code || 'launch error'}).`; this.phase = 'failed'; } });
    child.on('exit', (code, signal) => { if (this.child === child) { this.child = null; this.phase = 'failed'; this.error ||= `Local engine exited (${signal || code}). Try CPU mode or a smaller context in Settings.`; this.changed(); } });
    this.changed();
    try {
      for (let i = 0; i < 240; i++) {
        if (this.child !== child || this.phase === 'failed') throw new Error(this.error || 'Model loading stopped.');
        try {
          const response = await this.fetch('/v1/models', { signal: AbortSignal.timeout(1000) });
          const data = await response.json();
          if (data.data?.some(m => m.id === model.key)) { this.phase = 'ready'; this.config = JSON.stringify([settings.contextTokens, settings.acceleration]); this.changed(); return; }
        } catch {}
        await delay(500);
      }
      throw new Error('Model loading timed out. Try CPU mode or a smaller context in Settings.');
    } catch (e) { await this.stop(); this.phase = 'failed'; this.error = e.message; this.changed(); throw e; }
  }
  async fetch(route, options = {}) {
    if (!['/v1/models', '/v1/chat/completions', '/health'].includes(route)) throw new Error('Invalid local API path.');
    if (!this.child || !this.origin || !this.secret) throw new Error('Load a local model first.');
    const response = await fetch(this.origin + route, { ...options, redirect: 'error', headers: { 'Content-Type': 'application/json', ...options.headers, Authorization: `Bearer ${this.secret}` } });
    if (!response.ok) {
      // Server errors can echo prompts. Keep the error shown/stored by the app generic.
      await response.body?.cancel();
      throw new Error(response.status === 503 ? 'Local model is loading.' : response.status === 400 ? 'The local model rejected this request. Try a shorter request or a larger context.' : `Local engine request failed (${response.status}).`);
    }
    return response;
  }
  async stop() {
    const child = this.child;
    this.child = null; this.modelKey = null; this.origin = null; this.secret = null; this.phase = 'stopped';
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    this.changed();
  }
}
