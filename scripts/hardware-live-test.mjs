import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AirloService } from '../electron/core.mjs';

const root = path.resolve('test-results/hardware-live-' + Date.now());
const service = new AirloService(root);
const report = { checks: [] };
try {
  await service.init(); await service.settings({ hardwareRecommendations: true }); await service.scanHardware();
  const profile = service.snapshot().hardwareProfile;
  assert.ok(profile.memory.total > 0 && profile.memory.available > 0); assert.ok(profile.disk.available > 0);
  assert.equal(profile.gpuStatus, 'detected', 'Expected the test PC graphics device to be detected.');
  assert.ok(profile.gpus.every(g => g.total > 0 && g.available >= 0));
  assert.equal(service.runtime.child, null);
  await service.save(); const saved = await fs.readFile(path.join(root, 'state.json'), 'utf8');
  for (const value of [profile.cpu.name, ...profile.gpus.map(g => g.name), 'scannedAt', 'hardwareProfile']) assert.ok(!saved.includes(value));
  report.checks.push('explicit offline hardware scan; GPU detected; no inference process; no hardware data persisted');
  // Optional small public fixture download; never an automatic network operation.
  if (process.argv.includes('--hub')) {
    await service.settings({ offline: false });
    const repo = await service.modelFiles('ggml-org/models');
    const file = repo.files.find(f => f.name === 'tinyllamas/stories260K.gguf'); assert.ok(file); assert.ok(file.size < 10 * 1024 * 1024);
    const input = { repo: repo.repo, filename: file.name, revision: repo.revision };
    const preview = await service.previewModel(input); assert.equal(preview.memory.architecture, 'llama');
    const id = await service.startDownload(input), deadline = Date.now() + 120000;
    while (service.downloadJobs.size) { if (Date.now() > deadline) throw new Error('Fixture download timed out.'); await new Promise(r => setTimeout(r, 100)); }
    const job = service.state.downloads.find(d => d.id === id); assert.equal(job.status, 'complete', job.error); assert.equal(job.imported, true, job.importError);
    assert.equal(service.state.models[0].memory.architecture, 'llama');
    report.checks.push('public GGUF header preview; pinned small fixture download; checksum verification; library registration');
  }
  service.forgetHardware(); assert.equal(service.snapshot().hardwareProfile, null);
  report.checks.push('forget clears hardware snapshot'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally { await service.shutdown(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
