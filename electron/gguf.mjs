export const MAX_HEADER_BYTES = 16 * 1024 * 1024;
export function parseGGUFMetadata(bytes) {
  let offset = 0;
  const take = n => {
    if (!Number.isSafeInteger(n) || n < 0 || offset + n > MAX_HEADER_BYTES) throw new Error('GGUF metadata exceeds the supported limit.');
    if (offset + n > bytes.length) { const error = new Error('More GGUF header bytes are needed.'); error.code = 'GGUF_HEADER_INCOMPLETE'; throw error; }
    const at = offset; offset += n; return at;
  };
  const u32 = () => bytes.readUInt32LE(take(4));
  const u64 = () => { const n = Number(bytes.readBigUInt64LE(take(8))); if (!Number.isSafeInteger(n)) throw new Error('Invalid GGUF length.'); return n; };
  const string = (keep, limit = 512) => { const n = u64(), at = take(n); return keep ? bytes.toString('utf8', at, at + Math.min(n, limit)) : undefined; };
  const value = (type, keep, depth = 0) => {
    if (depth > 2) throw new Error('Invalid GGUF nesting.');
    if (type === 8) return string(keep);
    if (type === 9) { const element = u32(), count = u64(); if (count > 2000000) throw new Error('GGUF array is too large.'); for (let i = 0; i < count; i++) value(element, false, depth + 1); return undefined; }
    const size = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}[type];
    if (!size) throw new Error('Unsupported GGUF metadata type.');
    const at = take(size);
    return keep ? type === 4 ? bytes.readUInt32LE(at) : type === 10 ? Number(bytes.readBigUInt64LE(at)) : undefined : undefined;
  };
  if (bytes.toString('ascii', take(4), 4) !== 'GGUF' || ![2,3].includes(u32())) throw new Error('Unsupported GGUF header.');
  u64(); const count = u64(); if (count > 100000) throw new Error('Too many GGUF metadata entries.');
  const metadata = Object.create(null);
  for (let i = 0; i < count; i++) {
    const key = string(true), type = u32();
    const keep = /^(general\.(name|architecture|type|size_label)|[^.]+\.(context_length|block_count|embedding_length|attention\.(head_count|head_count_kv|key_length|value_length|sliding_window)))$/.test(key);
    const v = value(type, keep); if (keep) metadata[key] = v;
  }
  return metadata;
}

export function memoryMetadata(meta) {
  const arch = meta['general.architecture'];
  const number = suffix => { const n = meta[`${arch}.${suffix}`]; return Number.isSafeInteger(n) && n > 0 ? n : null; };
  return { architecture: typeof arch === 'string' ? arch.slice(0, 80) : '', context: number('context_length'),
    layers: number('block_count'), embedding: number('embedding_length'), heads: number('attention.head_count'), kvHeads: number('attention.head_count_kv'),
    keyLength: number('attention.key_length'), valueLength: number('attention.value_length'), slidingWindow: number('attention.sliding_window') };
}
