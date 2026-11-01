import { packager } from '@electron/packager';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), runtime = path.join(root, 'native', 'llama');
await fs.access(path.join(runtime, 'llama-server.exe')).catch(() => { throw new Error('Run npm run runtime:install before packaging.'); });
await fs.copyFile(path.join(root, 'scripts', 'runtime-lock.json'), path.join(runtime, 'airlobot-runtime.json'));
const result = await packager({ dir: root, name: 'AirloBot', platform: 'win32', arch: 'x64', out: 'release/standalone', overwrite: true, asar: true,
  icon: path.join(root, 'assets', 'airlobot.ico'), extraResource: [runtime],
  ignore: /^\/(release|data|test|scripts|src|test-results|docs|native|\.github|\.githooks)(\/|$)/ });
console.log('Standalone package:', result.join(', '));
