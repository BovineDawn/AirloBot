import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Read bounded metadata only; model weights remain in their original location.
export async function inspectModel(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !/\.gguf$/i.test(filename)) throw new Error('Choose a local GGUF file.');
  const file = await fs.realpath(filename), handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Choose a GGUF file, not a directory.');
    const bytes = Buffer.alloc(Math.min(stat.size, 64 * 1024 * 1024));
    let length = 0;
    while (length < bytes.length) { const r = await handle.read(bytes, length, bytes.length - length, null); if (!r.bytesRead) break; length += r.bytesRead; }
    let offset = 0;
    const take = n => { if (!Number.isSafeInteger(n) || n < 0 || offset + n > length) throw new Error('Invalid or oversized GGUF metadata.'); const at = offset; offset += n; return at; };
    const u32 = () => bytes.readUInt32LE(take(4));
    const u64 = () => { const n = Number(bytes.readBigUInt64LE(take(8))); if (!Number.isSafeInteger(n)) throw new Error('Invalid GGUF length.'); return n; };
    const string = keep => { const n = u64(), at = take(n); return keep ? bytes.toString('utf8', at, at + n) : undefined; };
    const value = (type, keep, depth = 0) => {
      if (depth > 2) throw new Error('Invalid GGUF metadata nesting.');
      if (type === 8) return string(keep);
      if (type === 9) { const element = u32(), count = u64(); if (count > 2000000) throw new Error('GGUF metadata array is too large.'); for (let i = 0; i < count; i++) value(element, false, depth + 1); return undefined; }
      const size = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }[type];
      if (!size) throw new Error('Unsupported GGUF metadata type.');
      const at = take(size);
      return keep ? type === 4 ? bytes.readUInt32LE(at) : type === 10 ? Number(bytes.readBigUInt64LE(at)) : undefined : undefined;
    };
    if (bytes.toString('ascii', take(4), 4) !== 'GGUF' || ![2, 3].includes(u32())) throw new Error('This is not a supported GGUF model.');
    u64(); const count = u64(); if (count > 100000) throw new Error('Too many GGUF metadata entries.');
    const meta = {};
    for (let i = 0; i < count; i++) { const key = string(true), type = u32(); const keep = /^(general\.(name|architecture|type|size_label)|[^.]+\.context_length)$/.test(key); const v = value(type, keep); if (keep) meta[key] = v; }
    if (/mmproj/i.test(path.basename(file)) || ['clip', 'mmproj'].includes(meta['general.architecture']) || meta['general.type'] === 'mmproj') throw new Error('This is a vision projector. Choose the main text model GGUF.');
    if (!meta['general.architecture']) throw new Error('GGUF has no model architecture.');
    return { key: 'local-' + createHash('sha256').update(process.platform === 'win32' ? file.toLowerCase() : file).digest('hex').slice(0, 24), path: file,
      display_name: meta['general.name'] || path.basename(file, '.gguf'), publisher: 'Local file', architecture: meta['general.architecture'],
      params_string: meta['general.size_label'] || '', quantization: { name: /(?:IQ|Q|F|BF)\d[\w-]*(?=\.gguf$)/i.exec(path.basename(file))?.[0] || 'GGUF' },
      size_bytes: stat.size, max_context_length: meta[meta['general.architecture'] + '.context_length'] || 8192, loaded_instances: [] };
  } finally { await handle.close(); }
}

export async function discoverModelFiles(root) {
  const files = [];
  async function walk(dir, depth) {
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      if (files.length >= 100) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && depth < 4) await walk(path.join(dir, entry.name), depth + 1);
      else if (entry.isFile() && /\.gguf$/i.test(entry.name) && !/mmproj|\-\d{5}-of-\d{5}/i.test(entry.name)) files.push(path.join(dir, entry.name));
    }
  }
  await walk(root, 0); return files;
}
