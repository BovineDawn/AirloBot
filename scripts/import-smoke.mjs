import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { CrocService } from '../electron/core.mjs';
const live = JSON.parse(await fs.readFile('test-results/live-report.json'));
const state = JSON.parse(await fs.readFile(path.join(live.dataDir, 'state.json')));
const source = state.downloads[0].path;
const testRoot = path.join(os.homedir(), '.lmstudio', 'models', 'CrocBotTests', 'DownloadVerification');
const target = path.join(testRoot, path.basename(source));
const report = { startedAt: new Date().toISOString(), source, testImportPath: target };
let created = false;
try {
  try { await fs.stat(target); throw new Error('The test destination already exists; refusing to change it.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const service = new CrocService(live.dataDir);
  await service.runLms(['import', source, '--hard-link', '--user-repo', 'CrocBotTests/DownloadVerification', '--yes']);
  created = true;
  const a = await fs.stat(source), b = await fs.stat(target);
  assert.equal(a.ino, b.ino); assert.equal(a.dev, b.dev);
  const inventory = JSON.parse(await service.runLms(['ls', '--json']));
  const found = inventory.find(m => m.path === 'CrocBotTests/DownloadVerification/' + path.basename(source));
  assert.ok(found, 'Imported GGUF is visible to the runtime');
  report.status = 'passed'; report.model = found; report.hardLinkVerified = true;
} catch (e) { report.status = 'failed'; report.error = e.message; process.exitCode = 1; }
finally {
  if (created) {
    const a = await fs.stat(source), b = await fs.stat(target);
    assert.equal(a.ino, b.ino); assert.equal(a.dev, b.dev);
    assert.equal(path.dirname(target), testRoot);
    await fs.unlink(target); // Only the new test link. The verified source is retained.
    await fs.rmdir(testRoot).catch(() => {});
    await fs.rmdir(path.dirname(testRoot)).catch(() => {});
    report.testLinkRemoved = true;
  }
  await fs.writeFile('test-results/import-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
