import { parseGGUFMetadata, memoryMetadata, MAX_HEADER_BYTES } from './gguf.mjs';

// Range-only metadata reads. A server that ignores Range is cancelled before its body is consumed.
export async function previewGGUF(url, size, fetcher, signal) {
  for (const limit of [65536, 262144, 1048576, 4194304, MAX_HEADER_BYTES]) {
    signal?.throwIfAborted();
    const end = Math.min(size, limit) - 1;
    if (end < 0) return { metadataError: 'unavailable' };
    const response = await fetcher(url, { signal, headers: { Range: `bytes=0-${end}` } });
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    if (response.status !== 206 || !range || Number(range[1]) !== end || Number(range[2]) !== size) {
      await response.body?.cancel(); return { metadataError: 'unavailable' };
    }
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength;
        if (length > end + 1) return { metadataError: 'unavailable' }; chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (length !== end + 1) return { metadataError: 'unavailable' };
    try {
      const meta = parseGGUFMetadata(Buffer.concat(chunks, length));
      if (!meta['general.architecture']) return { metadataError: 'unavailable' };
      return { memory: memoryMetadata(meta), projector: ['clip','mmproj'].includes(meta['general.architecture']) || meta['general.type'] === 'mmproj' };
    } catch (error) {
      if (error.code !== 'GGUF_HEADER_INCOMPLETE') return { metadataError: /Unsupported GGUF header/.test(error.message) ? 'format' : 'unavailable' };
      if (end + 1 === size) return { metadataError: 'unavailable' };
    }
  }
  return { metadataError: 'unavailable' };
}
