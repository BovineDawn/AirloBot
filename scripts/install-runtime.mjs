// Explicit developer/build step. The installed app never downloads executable code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await fs.readFile(new URL('./runtime-lock.json', import.meta.url), 'utf8'));
if (process.platform + '-' + process.arch !== lock.platform) throw new Error('This runtime bundle currently targets Windows x64.');
const staging = path.join(root, 'native'), destination = path.join(staging, 'llama'), zip = path.join(staging, lock.asset);
await fs.mkdir(staging, { recursive: true });
const response = await fetch(lock.url);
if (!response.ok) throw new Error(`Runtime download failed (${response.status}).`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== lock.sha256) throw new Error('Runtime checksum mismatch. Nothing was installed.');
await fs.writeFile(zip, bytes);
// Arguments travel in the environment, never interpolated into shell code.
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:AIRLO_RUNTIME_ZIP -DestinationPath $env:AIRLO_RUNTIME_TARGET -Force'], { windowsHide: true, env: { ...process.env, AIRLO_RUNTIME_ZIP: zip, AIRLO_RUNTIME_TARGET: destination } });
const license = await fetch(lock.license); if (!license.ok) throw new Error('Could not obtain the engine license.');
await fs.writeFile(path.join(destination, 'LICENSE-llama.cpp.txt'), await license.text());
await fs.writeFile(path.join(destination, 'airlobot-runtime.json'), JSON.stringify(lock, null, 2));
await fs.unlink(zip);
console.log(`Installed checksum-verified ${lock.engine} ${lock.release} (${lock.platform}).`);
