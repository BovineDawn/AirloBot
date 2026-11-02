import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtimeEnvironment } from './runtime.mjs';

const run = promisify(execFile), MiB = 1024 ** 2;
const label = value => String(value || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160);
export function parseDevices(stdout, stderr = '') {
  const devices = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(Vulkan\d+): (.+) \((\d+) MiB, (\d+) MiB free\)\s*$/.exec(line);
    if (!match || devices.length >= 8) continue;
    const total = Number(match[3]) * MiB, available = Number(match[4]) * MiB;
    if (!Number.isSafeInteger(total) || total <= 0 || total > 16 * 1024 ** 4 || available > total) continue;
    const index = match[1].slice(6);
    const diagnostic = stderr.split(/\r?\n/).find(s => s.includes(`ggml_vulkan: ${index} = `));
    const uma = /\| uma: ([01])\b/.exec(diagnostic || '');
    devices.push({ name: label(match[2]), backend: 'Vulkan', total, available, shared: uma ? uma[1] === '1' : null });
  }
  return devices;
}

// Explicit user action only. No files are enumerated; no identifiers or raw logs are retained.
export async function scanHardware({ runtimeDirectory, modelDirectory, signal }) {
  const cpus = os.cpus();
  const profile = { scannedAt: Date.now(), cpu: { name: label(cpus[0]?.model || 'CPU'), threads: cpus.length, architecture: os.arch() },
    memory: { total: os.totalmem(), available: os.freemem() }, disk: null, gpus: [], gpuStatus: 'unknown' };
  try { const disk = await fs.statfs(modelDirectory); profile.disk = { available: disk.bavail * disk.bsize }; } catch {}
  try {
    // The pinned engine exits after listing devices. It never loads a model or starts a server.
    const result = await run(path.join(runtimeDirectory, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'),
      ['--offline', '--verbose', '--list-devices'], { cwd: runtimeDirectory, env: runtimeEnvironment(''), windowsHide: true, shell: false, timeout: 20000, maxBuffer: 1024 * 1024, signal });
    profile.gpus = parseDevices(result.stdout, result.stderr);
    profile.gpuStatus = profile.gpus.length ? 'detected' : /Available devices:\s*\(none\)/.test(result.stdout) ? 'none' : 'unknown';
  } catch (error) { if (signal?.aborted) throw signal.reason; profile.gpuStatus = error.code === 'ENOENT' ? 'engine_missing' : 'unknown'; }
  signal?.throwIfAborted();
  return profile;
}
