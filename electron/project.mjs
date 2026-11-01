import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const excluded = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'release', 'data', '.codex', '.ssh', '.aws', '.azure', '.gnupg', '.venv', 'venv', '__pycache__', '.next', '.npmrc', '.pypirc', 'credentials', 'credentials.json']);
export const digest = text => createHash('sha256').update(text).digest('hex');
const within = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const textDestination = name => { if (/\.(docx?|xlsx?|pptx?|pdf|zip|png|jpe?g|gif|webp|ico|mp[34]|wav|exe|dll|bin|uasset|umap)$/i.test(name)) throw new Error('This format needs a dedicated document editor. Use a UTF-8 text, Markdown, or source file.'); };
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
  async resolve(value, { root = false, missing = false, parents = false } = {}) {
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
      } catch (error) { if (!(missing && (parents || i === parts.length - 1) && error.code === 'ENOENT')) throw error; }
    }
    return current;
  }
  async text(relative) {
    const file = await this.resolve(relative);
    const initial = await fs.lstat(file);
    if (!initial.isFile() || initial.size > 1048576) throw new Error('Only UTF-8 text files up to 1 MiB can be read. Word, PDF, and other binary formats need a text export.');
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.ino !== initial.ino || stat.dev !== initial.dev || stat.size > 1048576) throw new Error('File changed while opening. Try again.');
      await this.resolve(relative);
      const buffer = Buffer.alloc(1048577);
      let length = 0;
      while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null); if (!bytesRead) break; length += bytesRead; }
      if (length > 1048576) throw new Error('File exceeds the text limit.');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
      if (content.includes('\0')) throw new Error('Binary files are not supported.');
      return { content, hash: digest(content), mode: stat.mode };
    } finally { await handle.close(); }
  }
  async list(directory = '.', signal, cursor = 0) {
    const base = projectPath(directory, true), entries = []; let excluded = 0;
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error('Invalid directory cursor.');
    for (const item of (await fs.readdir(await this.resolve(base, { root: true }), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      signal?.throwIfAborted();
      const name = base === '.' ? item.name : base + '/' + item.name;
      try { projectPath(name); } catch { excluded++; continue; }
      if (item.isSymbolicLink()) { excluded++; continue; }
      if (item.isDirectory() || item.isFile()) entries.push({ path: name, type: item.isDirectory() ? 'directory' : 'file' });
    }
    const next = cursor + 100 < entries.length ? cursor + 100 : null;
    return { directory: base, entries: entries.slice(cursor, cursor + 100), next_cursor: next, truncated: next !== null, total: entries.length, excluded,
      note: 'One directory per page. Open subdirectories by path; use next_cursor for more entries. Credential paths, generated folders and links are excluded.' };
  }
  async read(relative, startLine = 1, maxLines = 100, startChar) {
    const name = projectPath(relative), file = await this.text(name), lines = file.content.split('\n');
    const start = startChar ?? (startLine <= 1 ? 0 : Math.min(file.content.length, lines.slice(0, startLine - 1).join('\n').length + 1));
    if (!Number.isInteger(start) || start < 0 || start > file.content.length) throw new Error('Read offset is outside the file.');
    const line = file.content.slice(0, start).split('\n').length;
    const remaining = file.content.slice(start), selection = remaining.split('\n').slice(0, maxLines).join('\n');
    const raw = (selection + (selection.length < remaining.length ? '\n' : '')).slice(0, 6000);
    const end = start + raw.length, complete = start === 0 && end === file.content.length;
    return { path: name, startLine: line, totalLines: lines.length, content: raw.split('\n').map((v, i) => `${line + i}: ${v}`).join('\n'),
      raw, start, end, totalChars: file.content.length, next_start_char: end < file.content.length ? end : null, truncated: end < file.content.length, complete, hash: file.hash };
  }
  async search(query, directory = '.', signal, cursor = 0) {
    const matches = [], queue = [projectPath(directory, true)]; let skipped = 0, visited = 0, scanned = 0, directories = 0, truncated = false;
    while (queue.length && directories++ < 4000) {
      const dir = queue.shift(); let page = 0;
      do {
        const inventory = await this.list(dir, signal, page);
        for (const item of inventory.entries) {
          signal?.throwIfAborted();
          if (item.type === 'directory') { queue.push(item.path); continue; }
          if (visited++ < cursor) continue;
          if (scanned >= 200 || matches.length >= 30) return { matches, skipped, scanned, truncated: true, next_cursor: visited - 1, note: 'Continue with next_cursor to search more files. Order can change if files change.' };
          scanned++;
          try {
            const file = await this.text(item.path);
            for (const [index, line] of file.content.split('\n').entries()) {
              if (!line.toLowerCase().includes(query.toLowerCase())) continue;
              if (matches.length >= 30) return { matches, skipped, scanned, truncated: true, next_cursor: visited,
                note: 'Match limit reached inside this file. Read the last matched file or narrow the query for remaining matches. next_cursor continues with subsequent files.' };
              matches.push({ path: item.path, line: index + 1, text: line.slice(0, 220) });
            }
          }
          catch { skipped++; }
        }
        page = inventory.next_cursor;
      } while (page !== null);
    }
    truncated = queue.length > 0;
    return { matches, skipped, scanned, truncated, next_cursor: null, ...(truncated ? { note: 'Directory scan limit reached. Search a narrower subdirectory.' } : {}) };
  }
  async prepare(relative, content, reason, reads, directories = []) {
    const name = projectPath(relative);
    textDestination(name);
    const parent = path.posix.dirname(name);
    const plannedParent = directories.some(p => p.operation === 'mkdir' && p.status === 'pending' && (p.path === parent || p.path.startsWith(parent + '/')));
    await this.resolve(name, { missing: true, parents: plannedParent });
    let before = null;
    try { before = await this.text(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before && (!reads.get(name)?.complete || reads.get(name).hash !== before.hash)) throw new Error('Read the entire current file before proposing its replacement. Use a smaller file if the read is truncated.');
    if (before?.content.length > 24000) throw new Error('Use propose_edit for targeted changes to a larger file.');
    return { id: randomUUID(), operation: 'write', path: name, reason, before: before?.content ?? null, beforeHash: before?.hash ?? null, after: content, status: 'pending', needsDirectory: plannedParent ? parent : null };
  }
  async prepareEdit(relative, oldText, newText, reason, reads) {
    const name = projectPath(relative); textDestination(name);
    const before = await this.text(name), evidence = reads.get(name);
    if (before.content.includes('\r\n')) { oldText = oldText.replace(/\r?\n/g, '\r\n'); newText = newText.replace(/\r?\n/g, '\r\n'); }
    if (!oldText || oldText === newText) throw new Error('Provide an exact, nonempty passage and a different replacement.');
    const start = before.content.indexOf(oldText), end = start + oldText.length;
    if (start < 0 || before.content.indexOf(oldText, start + 1) !== -1) throw new Error('The original text must occur exactly once. Read the file and include enough surrounding text.');
    if (evidence?.hash !== before.hash || (!evidence.complete && !evidence.ranges?.some(([a,b]) => a <= start && b >= end))) throw new Error('Read the current passage before proposing an edit.');
    const after = before.content.slice(0, start) + newText + before.content.slice(end);
    if (Buffer.byteLength(after) > 1048576) throw new Error('Edited file exceeds 1 MiB.');
    return { id: randomUUID(), operation: 'edit', path: name, reason, before: before.content, beforeHash: before.hash, after, status: 'pending' };
  }
  async prepareDirectory(relative, reason) {
    const name = projectPath(relative), target = await this.resolve(name, { missing: true, parents: true });
    try { await fs.lstat(target); throw new Error('This path already exists.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { id: randomUUID(), operation: 'mkdir', path: name, reason, before: null, after: null, beforeHash: null, status: 'pending' };
  }
  async apply(change) {
    if (change.operation === 'mkdir') {
      const created = [];
      for (const [index] of projectPath(change.path).split('/').entries()) {
        const name = change.path.split('/').slice(0, index + 1).join('/'), target = await this.resolve(name, { missing: true });
        try { await fs.mkdir(target); created.push(name); } catch (e) { if (e.code !== 'EEXIST' || !(await fs.lstat(target)).isDirectory()) throw e; }
        await this.resolve(name);
      }
      change.createdDirectories = created; return 'directory';
    }
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
  async undo(change) {
    if (change.operation === 'mkdir') {
      const names = [...(change.createdDirectories || [])].reverse();
      // Inspect all descendants first. Never recursively delete a directory.
      for (let i = 0; i < names.length; i++) {
        const entries = await fs.readdir(await this.resolve(names[i]));
        const expectedChild = i > 0 ? path.posix.basename(names[i - 1]) : null;
        if (entries.some(e => e !== expectedChild)) throw new Error('The created folder contains files. Remove or undo those changes before undoing this folder.');
      }
      for (const name of names) await fs.rmdir(await this.resolve(name));
      return;
    }
    const current = await this.text(change.path);
    if (current.hash !== change.appliedHash) throw new Error('This file changed after AirloBot applied it. Undo would overwrite newer work.');
    if (change.before === null) await fs.unlink(await this.resolve(change.path));
    else await this.apply({ path: change.path, beforeHash: current.hash, after: change.before });
  }
}

export function rememberRead(reads, result) {
  const old = reads.get(result.path), ranges = old?.hash === result.hash ? [...old.ranges || [], [result.start, result.end]] : [[result.start, result.end]];
  ranges.sort((a,b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) { const last = merged.at(-1); if (last && last[1] >= range[0]) last[1] = Math.max(last[1], range[1]); else merged.push([...range]); }
  reads.set(result.path, { hash: result.hash, ranges: merged, complete: merged.length === 1 && merged[0][0] === 0 && merged[0][1] === result.totalChars });
}
