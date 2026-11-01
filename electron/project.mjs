import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const excluded = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'release', 'data', '.codex', '.ssh', '.aws', '.azure', '.gnupg', '.venv', 'venv', '__pycache__', '.next', '.npmrc', '.pypirc', 'credentials', 'credentials.json']);
export const digest = text => createHash('sha256').update(text).digest('hex');
const within = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
export function projectPath(value, allowRoot = false) {
  if (typeof value !== 'string' || value.length > 400) throw new Error('Use a short project-relative path.');
  const name = value.replaceAll('\\', '/');
  if (allowRoot && (name === '.' || name === '')) return '.';
  const parts = name.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw new Error('Path must stay inside the selected project.');
  if (parts.some(p => excluded.has(p.toLowerCase()) || /^\.env($|\.)/i.test(p) || /\.(pem|key|pfx|p12|gguf)$/i.test(p))) throw new Error('This path is excluded from project tools.');
  return name;
}

export class ProjectFiles {
  constructor(root) { this.root = root; }
  static async open(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Choose a project folder.');
    const canonical = await fs.realpath(root);
    if (!(await fs.stat(canonical)).isDirectory() || canonical === path.parse(canonical).root) throw new Error('Choose a project directory, not an entire drive.');
    return new ProjectFiles(canonical);
  }
  async resolve(value, { root = false, missing = false } = {}) {
    const relative = projectPath(value, root);
    // Detect replacement of the selected directory after it was authorized.
    if (await fs.realpath(this.root) !== this.root) throw new Error('Project location changed. Select it again.');
    let current = this.root;
    const parts = relative === '.' ? [] : relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) throw new Error('Symbolic links and junctions are excluded.');
        const real = await fs.realpath(current);
        if (!within(this.root, real)) throw new Error('Path is outside this project.');
        if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('Parent is not a directory.');
      } catch (error) { if (!(missing && i === parts.length - 1 && error.code === 'ENOENT')) throw error; }
    }
    return current;
  }
  async text(relative) {
    const file = await this.resolve(relative);
    const initial = await fs.lstat(file);
    if (!initial.isFile() || initial.size > 65536) throw new Error('Only text files up to 64 KiB can be read.');
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.ino !== initial.ino || stat.dev !== initial.dev || stat.size > 65536) throw new Error('File changed while opening. Try again.');
      await this.resolve(relative);
      const buffer = Buffer.alloc(65537);
      let length = 0;
      while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null); if (!bytesRead) break; length += bytesRead; }
      if (length > 65536) throw new Error('File exceeds the text limit.');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
      if (content.includes('\0')) throw new Error('Binary files are not supported.');
      return { content, hash: digest(content), mode: stat.mode };
    } finally { await handle.close(); }
  }
  async list(directory = '.', signal) {
    const base = projectPath(directory, true), entries = [];
    let visited = 0, truncated = false;
    const walk = async (dir, depth) => {
      signal?.throwIfAborted();
      const absolute = await this.resolve(dir, { root: true });
      for (const item of (await fs.readdir(absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        signal?.throwIfAborted();
        if (++visited > 1200 || entries.length >= 200) { truncated = true; return; }
        const name = dir === '.' ? item.name : dir + '/' + item.name;
        try { projectPath(name); } catch { continue; }
        if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) { entries.push({ path: name, type: 'directory' }); if (depth < 3) await walk(name, depth + 1); else truncated = true; }
        else if (item.isFile()) entries.push({ path: name, type: 'file' });
      }
    };
    await walk(base, 0);
    return { entries, truncated, note: 'Generated folders, common credential paths, model weights and links are excluded. Maximum depth: 4.' };
  }
  async read(relative, startLine = 1, maxLines = 100) {
    const name = projectPath(relative), file = await this.text(name), lines = file.content.split('\n');
    const selected = lines.slice(startLine - 1, startLine - 1 + maxLines).map((line, i) => `${i + startLine}: ${line}`).join('\n');
    const truncated = selected.length > 6000 || startLine - 1 + maxLines < lines.length;
    return { path: name, startLine, totalLines: lines.length, content: selected.slice(0, 6000), truncated, complete: startLine === 1 && !truncated, hash: file.hash };
  }
  async search(query, directory = '.', signal) {
    const inventory = await this.list(directory, signal), matches = [];
    let skipped = 0;
    for (const item of inventory.entries.filter(e => e.type === 'file')) {
      signal?.throwIfAborted();
      try {
        const file = await this.text(item.path);
        for (const [index, line] of file.content.split('\n').entries()) {
          if (line.toLowerCase().includes(query.toLowerCase())) matches.push({ path: item.path, line: index + 1, text: line.slice(0, 220) });
          if (matches.length >= 30) return { matches, truncated: true, skipped };
        }
      } catch { skipped++; }
    }
    return { matches, truncated: inventory.truncated, skipped };
  }
  async prepare(relative, content, reason, reads) {
    const name = projectPath(relative);
    await this.resolve(name, { missing: true });
    let before = null;
    try { before = await this.text(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before && (!reads.get(name)?.complete || reads.get(name).hash !== before.hash)) throw new Error('Read the entire current file before proposing its replacement. Use a smaller file if the read is truncated.');
    if (before?.content.length > 6000) throw new Error('Replacement proposals are limited to small files (6000 characters).');
    return { id: randomUUID(), path: name, reason, before: before?.content ?? null, beforeHash: before?.hash ?? null, after: content, status: 'pending' };
  }
  async apply(change) {
    const target = await this.resolve(change.path, { missing: true });
    const current = async () => { try { return await this.text(change.path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
    const before = await current();
    if ((before?.hash ?? null) !== change.beforeHash) throw new Error('The file changed after this proposal. Run a new task to review the current version.');
    const temporary = path.join(path.dirname(target), `.airlobot-${randomUUID()}.tmp`);
    let committed = false;
    try {
      await fs.writeFile(temporary, change.after, { flag: 'wx', mode: before?.mode ?? 0o600 });
      await this.resolve(change.path, { missing: true });
      if (((await current())?.hash ?? null) !== change.beforeHash) throw new Error('The file changed before applying. No replacement was made.');
      // New files use an exclusive link so a concurrently created destination is never overwritten.
      if (before === null) await fs.link(temporary, target);
      else await fs.rename(temporary, target);
      committed = true;
    } finally { await fs.unlink(temporary).catch(e => { if (!committed && e.code !== 'ENOENT') throw e; }); }
    return digest(change.after);
  }
}
