import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AirloService } from '../electron/core.mjs';

if (!process.argv[2]) throw new Error('Pass a local GGUF path as the first argument.');
const source = await fs.realpath(path.resolve(process.argv[2]));
const root = path.resolve('test-results/import-' + Date.now());
const service = new AirloService(root);
const before = await fs.stat(source);
try {
  await service.init();
  const model = await service.registerModel(source);
  const duplicate = await service.registerModel(source);
  assert.equal(duplicate.key, model.key);
  const after = await fs.stat(source);
  assert.equal(after.ino, before.ino); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  await service.shutdown();
  const restored = new AirloService(root);
  try { await restored.init(); assert.ok(restored.state.models.some(m => m.key === model.key)); }
  finally { await restored.shutdown(); }
  console.log('PASS: local GGUF registration persists without copying, moving, or changing the original file.');
} finally { await service.shutdown(); }
