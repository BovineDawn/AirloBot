import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseGGUFMetadata, memoryMetadata, MAX_HEADER_BYTES } from './gguf.mjs';

// Read bounded metadata only; model weights remain in their original location.
export async function inspectModel(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !/\.gguf$/i.test(filename)) throw new Error('Choose a local GGUF file.');
  const file = await fs.realpath(filename), handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Choose a GGUF file, not a directory.');
    const bytes = Buffer.alloc(Math.min(stat.size, MAX_HEADER_BYTES));
    let length = 0;
    while (length < bytes.length) { const r = await handle.read(bytes, length, bytes.length - length, null); if (!r.bytesRead) break; length += r.bytesRead; }
    const meta = parseGGUFMetadata(bytes.subarray(0, length));
    if (/mmproj/i.test(path.basename(file)) || ['clip', 'mmproj'].includes(meta['general.architecture']) || meta['general.type'] === 'mmproj') throw new Error('This is a vision projector. Choose the main text model GGUF.');
    if (!meta['general.architecture']) throw new Error('GGUF has no model architecture.');
    return { key: 'local-' + createHash('sha256').update(process.platform === 'win32' ? file.toLowerCase() : file).digest('hex').slice(0, 24), path: file,
      display_name: meta['general.name'] || path.basename(file, '.gguf'), publisher: 'Local file', architecture: meta['general.architecture'],
      params_string: meta['general.size_label'] || '', quantization: { name: /(?:IQ|Q|F|BF)\d[\w-]*(?=\.gguf$)/i.exec(path.basename(file))?.[0] || 'GGUF' },
      size_bytes: stat.size, memory: memoryMetadata(meta), max_context_length: meta[meta['general.architecture'] + '.context_length'] || 8192, loaded_instances: [] };
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
