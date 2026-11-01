// Scan Git objects, never local conversation files. Report filenames, not secrets.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const privatePath = /(^|\/)(data|user-data|test-results|release|electron-profile|models|logs|backups|screenshots|captures|node_modules|\.ssh|\.aws|\.codex|\.agents)(\/|$)|(^|\/)(state\.json(?:\.tmp)?|conversations\.json|drafts\.json|history\.json|\.env(?:\..*)?)$|\.(gguf|safetensors|pem|key|pfx|p12|sqlite3?|db|log|dmp|heapsnapshot)$/i;
export const isPrivatePath = name => privatePath.test(name.replaceAll('\\', '/')) && !/(^|\/)\.env\.example$/.test(name);
export function contentRisks(text) {
  const rules = {
    'personal home path': /[A-Z]:[\\/]+Users[\\/]+(?!Public(?:[\\/]|$)|Default(?:[\\/]|$)|Example(?:[\\/]|$)|Fixture(?:[\\/]|$))[^\\/\s"'<>]+|\/(?:home|Users)\/(?!example(?:\/|$)|user(?:\/|$)|fixture(?:\/|$))[^/\s"'<>]+/i,
    'access token': /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/,
    'private key': /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  };
  return Object.entries(rules).filter(([, expression]) => expression.test(text)).map(([label]) => label);
}
export function checkRepository(history = false, cwd) {
  const git = args => execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  const entries = history
    ? git(['rev-list', '--objects', '--all']).toString().split('\n').filter(line => line.includes(' ')).map(line => ({ oid: line.slice(0, line.indexOf(' ')), name: line.slice(line.indexOf(' ') + 1) }))
    : git(['ls-files', '-s', '-z']).toString().split('\0').filter(Boolean).map(line => ({ oid: line.split(' ')[1], name: line.slice(line.indexOf('\t') + 1) }));
  const findings = [], scanned = new Set();
  for (const { oid, name } of entries) {
    if (isPrivatePath(name)) findings.push({ file: name, risk: 'private runtime data or credential path' });
    if (scanned.has(oid)) continue;
    scanned.add(oid);
    if (git(['cat-file', '-t', oid]).toString().trim() !== 'blob') continue;
    const bytes = git(['cat-file', 'blob', oid]);
    if (bytes.includes(0)) continue; // Binary icons are audited as assets, not text.
    for (const risk of contentRisks(bytes.toString('utf8'))) findings.push({ file: name, risk });
  }
  return { objects: scanned.size, findings };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = checkRepository(process.argv.includes('--history'));
    if (result.findings.length) {
      console.error('Privacy check blocked publishing. Remove the reported material from the affected commits; do not bypass the hook.');
      for (const item of result.findings) console.error(`${item.file}: ${item.risk}`);
      process.exitCode = 1;
    } else console.log(`Privacy check passed (${result.objects} Git objects): no recognized private-data paths, personal home paths, tokens or private keys.`);
  } catch (error) { console.error('Privacy check could not complete:', error.message); process.exitCode = 1; }
}
