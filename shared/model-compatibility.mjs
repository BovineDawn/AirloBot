const GiB = 1024 ** 3;
export const HARDWARE_MAX_AGE = 15 * 60 * 1000;
export const quantizationName = name => /(?:^|[.\-_])((?:IQ|Q|BF|F)\d[A-Z0-9_]*(?:-[A-Z0-9_]+)?)(?=\.gguf$)/i.exec(name || '')?.[1]?.toUpperCase() || 'GGUF';

// Estimates are deliberately limited to architectures with a conventional attention cache.
const knownCache = new Set(['llama','qwen2','qwen3','gemma','gemma2','gemma3','phi3','mistral']);
export function memoryEstimate(file, context = 16384) {
  const size = file.size || file.size_bytes, m = file.memory;
  if (!Number.isFinite(size) || size <= 0 || !m || !knownCache.has(m.architecture)) return null;
  const dimension = m.embedding / m.heads, key = m.keyLength || dimension, value = m.valueLength || dimension;
  if (![m.layers,m.heads,m.kvHeads,key,value,m.context,context].every(n => Number.isSafeInteger(n) && n > 0) || m.layers > 256 || m.heads > 512 || m.kvHeads > m.heads || key > 4096 || value > 4096) return null;
  const tokens = Math.min(context, m.context);
  // F16 key/value cache, all layers at full context: conservative for sliding-window models.
  const cache = tokens * m.layers * m.kvHeads * (key + value) * 2;
  return { bytes: size + cache + Math.max(GiB, size * .15), cacheBytes: cache, context: tokens, conservative: !!m.slidingWindow };
}
export function modelCompatibility(file, profile, settings = {}, now = Date.now()) {
  const result = (level, label, reason, extra = {}) => ({ level, label, reason, ...extra });
  if (file.projector || file.split) return result('unsupported', 'Unsupported', file.projector ? 'Vision projectors are not supported in this release.' : 'Split GGUF downloads are not supported in this release.');
  if (file.metadataError === 'format') return result('unsupported', 'Unsupported', 'The file does not contain a supported GGUF header.');
  if (!settings.hardwareRecommendations) return result('unknown', 'Hardware check off', 'Enable hardware recommendations in Settings to compare this model with your device.');
  if (!profile) return result('unknown', 'Scan needed', 'Choose Scan now to take a private, local hardware snapshot.');
  if (!Number.isFinite(profile.scannedAt) || now - profile.scannedAt > HARDWARE_MAX_AGE || profile.scannedAt > now + 60000) return result('unknown', 'Refresh scan', 'This memory snapshot is out of date. Refresh it before comparing models.');
  const size = file.size || file.size_bytes;
  if (!file.installed && profile.disk && size > profile.disk.available) return result('disk', 'Not enough disk space', 'The selected library drive needs more free space. Disk space is checked again when the download starts.');
  const estimate = memoryEstimate(file, settings.contextTokens);
  if (!estimate) return result('unknown', 'Memory fit unknown', 'Detailed memory estimates are unavailable for this model architecture or its metadata. File size alone cannot predict runtime memory.');
  const ram = Math.max(0, (profile.memory?.available || 0) - 2 * GiB);
  const gpu = settings.acceleration === 'cpu' ? null : [...(profile.gpus || [])].sort((a,b) => b.available - a.available)[0];
  const extra = { estimate };
  if (gpu) {
    // Never add GPU capacity to RAM: shared/integrated memory must not be double-counted.
    const usable = Math.max(0, Math.min(gpu.available - GiB, ram));
    const capacity = gpu.shared === false ? Math.max(0, gpu.available - GiB) : usable;
    if (ram >= 2 * GiB && estimate.bytes <= capacity * .85) return result('good', 'Likely fits comfortably', 'Estimated weights, context cache and working buffers leave memory headroom. Loading support and speed are not guaranteed.', extra);
    if (ram >= GiB && estimate.bytes <= capacity) return result('tight', 'Limited headroom', 'Consider a smaller version or shorter context. Other apps and loaded models reduce available memory.', extra);
    if (estimate.bytes <= ram) return result('slow', 'May run slowly', 'This estimate exceeds available GPU memory. CPU assistance or CPU mode may be needed.', extra);
    return result('tight', 'Memory pressure likely', 'The estimate exceeds a single GPU and available system-memory budgets. Try a smaller file or shorter context; combined multi-GPU placement is not estimated.', extra);
  }
  if (settings.acceleration !== 'cpu' && profile.gpuStatus !== 'none') return result('unknown', 'GPU memory unknown', 'GPU detection was incomplete. RAM alone is not enough to predict GPU fit.', extra);
  return estimate.bytes <= ram ? result('slow', 'CPU memory fits', 'The estimate fits available system memory. CPU generation speed has not been measured.', extra)
    : result('tight', 'Memory pressure likely', 'The model and context estimate exceed available system memory. Choose a smaller file or shorter context.', extra);
}

export function chooseVariants(files) {
  const usable = files.filter(f => !f.projector && !f.split && f.sha256 && f.size > 0);
  const pick = patterns => patterns.map(p => usable.filter(f => p.test(f.quantization || quantizationName(f.name))).sort((a,b) => a.size - b.size)[0]).find(Boolean);
  const balanced = pick([/^Q4_K_M$/, /^Q4_K/, /^Q4_0$/, /^Q5_K_M$/, /^Q8_0$/]) || [...usable].sort((a,b) => a.size - b.size)[0];
  const smaller = [...usable].filter(f => f.size < (balanced?.size || Infinity)).sort((a,b) => b.size - a.size)[0];
  const precision = pick([/^Q5_K_M$/, /^Q6_K$/, /^Q8_0$/]);
  const choices = [{ file: balanced, label: 'Balanced starting point' }, { file: smaller, label: 'Smaller download' }, { file: precision, label: 'Higher precision' }].filter(v => v.file);
  return choices.filter((v, i) => choices.findIndex(other => other.file.name === v.file.name) === i);
}
