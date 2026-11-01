import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isPrivatePath, contentRisks, checkRepository } from '../scripts/privacy-check.mjs';
test('publishing guard recognizes runtime data and credential paths', () => {
  for (const name of ['data/state.json', 'nested/data/state.json', 'backup/state.json', 'test-results/report.json', 'release/app.exe', '.env.local', 'a/private.key', 'models/local.gguf', 'screenshots/window.png', 'drafts.json', 'hardware-profile.json', 'hardware-scan.json', 'device-profile.json']) assert.equal(isPrivatePath(name), true, name);
  for (const name of ['src/FocusApp.jsx', 'test/agents.test.mjs', 'docs/README.txt', '.env.example']) assert.equal(isPrivatePath(name), false, name);
});
test('publishing guard examines staged bytes and catches force-added local data', async t => {
  const parent = path.resolve('test-results/privacy-unit'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(async () => { assert.ok(root.startsWith(parent + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init']); await fs.mkdir(path.join(root, 'data')); await fs.writeFile(path.join(root, 'data/state.json'), '{"fixture":true}');
  await fs.writeFile(path.join(root, '.gitignore'), 'data/\n'); git(['add', '.gitignore']); git(['add', '-f', 'data/state.json']);
  assert.ok(checkRepository(false, root).findings.some(f => f.file === 'data/state.json'));
  git(['rm', '--cached', 'data/state.json']);
  await fs.writeFile(path.join(root, 'example.txt'), 'ghp_' + 'x'.repeat(36)); git(['add', 'example.txt']);
  await fs.writeFile(path.join(root, 'example.txt'), 'Clean working copy, but the index still has the token.');
  assert.ok(checkRepository(false, root).findings.some(f => f.risk === 'access token'));
});
test('publishing guard flags recognizable sensitive content without echoing it', () => {
  assert.deepEqual(contentRisks('C:' + '\\Users\\' + 'private-person\\notes'), ['personal home path']);
  assert.deepEqual(contentRisks('ghp_' + 'x'.repeat(36)), ['access token']);
  assert.deepEqual(contentRisks('-----BEGIN ' + 'PRIVATE KEY-----'), ['private key']);
  assert.deepEqual(contentRisks('http://127.0.0.1:1234 and %USERPROFILE%'), []);
});
