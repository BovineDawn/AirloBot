import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AirloService } from '../electron/core.mjs';
import { parseDevices } from '../electron/hardware.mjs';
import { parseGGUFMetadata, memoryMetadata } from '../electron/gguf.mjs';
import { previewGGUF } from '../electron/model-preview.mjs';
import { memoryEstimate, modelCompatibility, chooseVariants, quantizationName, HARDWARE_MAX_AGE, hardwareBudget, suggestedVariant } from '../shared/model-compatibility.mjs';
import { catalogMetrics, fileSizeRange } from '../shared/model-catalog.mjs';

const GiB = 1024 ** 3, revision = 'a'.repeat(40);
const profile = () => ({ scannedAt: Date.now(), cpu: { name: 'Private fixture processor', threads: 8, architecture: 'x64' }, memory: { total: 32 * GiB, available: 24 * GiB }, disk: { available: 80 * GiB }, gpus: [{ name: 'Private fixture GPU', backend: 'Vulkan', available: 11 * GiB, total: 12 * GiB, shared: false }], gpuStatus: 'detected' });
const metadata = { architecture: 'llama', context: 32768, layers: 32, embedding: 4096, heads: 32, kvHeads: 8 };
const file = { name: 'example-Q4_K_M.gguf', size: 4 * GiB, memory: metadata };
const settings = { hardwareRecommendations: true, contextTokens: 8192, acceleration: 'auto' };
function gguf(extra = {}) {
  const values = { 'general.architecture': 'llama', 'llama.context_length': 32768, 'llama.block_count': 32, 'llama.embedding_length': 4096, 'llama.attention.head_count': 32, 'llama.attention.head_count_kv': 8, ...extra };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const str = s => { const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(Buffer.byteLength(s))); return Buffer.concat([len, Buffer.from(s)]); };
  const header = Buffer.alloc(24); header.write('GGUF'); header.writeUInt32LE(3, 4); header.writeBigUInt64LE(BigInt(Object.keys(values).length), 16);
  return Buffer.concat([header, ...Object.entries(values).flatMap(([k, v]) => [str(k), u32(typeof v === 'string' ? 8 : 4), typeof v === 'string' ? str(v) : u32(v)])]);
}
async function fixture(t, options = {}) {
  const parent = path.resolve('test-results/hardware-unit'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  const service = new AirloService(root, () => {}, options); await service.init();
  t.after(async () => { await service.shutdown(); assert.ok(root.startsWith(parent + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return service;
}

test('hardware scanning requires opt-in and snapshots never reach persisted state', async t => {
  let scans = 0; const s = await fixture(t, { hardwareScanner: async () => { scans++; return profile(); } });
  assert.equal(s.state.settings.hardwareRecommendations, false); assert.equal(scans, 0);
  await assert.rejects(s.scanHardware(), /Enable/);
  await assert.rejects(s.settings({ hardwareRecommendations: 'yes' }), /Invalid/);
  await s.settings({ hardwareRecommendations: true }); assert.equal(scans, 0);
  await s.scanHardware(); assert.equal(scans, 1); assert.equal(s.snapshot().hardwareProfile.cpu.name, 'Private fixture processor');
  await s.settings({ temperature: .3 });
  const saved = await fs.readFile(path.join(s.dataDir, 'state.json'), 'utf8');
  assert.ok(!saved.includes('Private fixture')); assert.ok(!saved.includes('hardwareProfile')); assert.ok(!saved.includes('scannedAt'));
  const restarted = new AirloService(s.dataDir); await restarted.init();
  assert.equal(restarted.snapshot().hardwareProfile, null); assert.equal(restarted.state.settings.hardwareRecommendations, true); await restarted.shutdown();
  s.forgetHardware(); assert.equal(s.snapshot().hardwareProfile, null);
  await s.scanHardware(); await s.settings({ hardwareRecommendations: false }); assert.equal(s.snapshot().hardwareProfile, null);
});

test('catalog metrics retain unknown values and size ranges cover supported files, not the whole repository', () => {
  assert.deepEqual(catalogMetrics({downloads:123,likes:0,lastModified:'2026-10-01T12:00:00Z'}),{downloads:123,likes:0,lastModified:'2026-10-01T12:00:00.000Z'});
  assert.deepEqual(catalogMetrics({downloads:-1,likes:'100',lastModified:'invalid'}),{downloads:null,likes:null,lastModified:null});
  const row=(size,extra={})=>({size,sha256:'a'.repeat(64),...extra});
  assert.deepEqual(fileSizeRange([row(4),row(8),row(30,{split:true}),row(1,{projector:true}),row(2,{sha256:null})]),{min:4,max:8,count:2});
  assert.equal(fileSizeRange([]),null);
});

test('guidance suggests a smaller checked version and never promises fit for unknown architectures or stale snapshots', () => {
  const rows=[{...file,name:'m-Q4_K_M.gguf',size:8*GiB,sha256:'a'}, {...file,name:'m-Q3_K_M.gguf',size:4*GiB,sha256:'b'}];
  assert.equal(suggestedVariant(rows,profile(),settings).name,'m-Q3_K_M.gguf');
  assert.equal(suggestedVariant(rows,{...profile(),scannedAt:0},settings),null);
  assert.equal(suggestedVariant(rows,profile(),{...settings,hardwareRecommendations:false}),null);
  const unknown={...rows[0],memory:{architecture:'gemma4'}};
  assert.notEqual(modelCompatibility(unknown,profile(),settings).level,'good');
  assert.equal(suggestedVariant([unknown],profile(),settings),null);
  assert.equal(modelCompatibility({...unknown,size:30*GiB},profile(),settings).label,'Weights exceed GPU budget');
  const shared=profile(); shared.memory.available=5*GiB;shared.gpus[0].shared=true;
  assert.ok(hardwareBudget(shared,settings).capacity<=3*GiB);
});

test('search and file details expose popularity and repository dates without sending hardware data', async t => {
  const service=await fixture(t,{hardwareScanner:async()=>profile()});
  await service.settings({hardwareRecommendations:true}); await service.scanHardware();
  await assert.rejects(service.searchModels('demo'),/Offline/);
  await service.settings({offline:false});
  const original=global.fetch; t.after(()=>{global.fetch=original;}); const sent=[];
  global.fetch=async(url,options)=>{
    sent.push(JSON.stringify({url,options}));
    const info={id:'publisher/demo',sha:revision,downloads:120,likes:8,lastModified:'2026-10-01T12:00:00Z',siblings:[]};
    return Response.json(url.includes('?search=') ? [info] : info);
  };
  const rows=await service.searchModels('demo'); const info=await service.modelFiles(rows[0].id);
  assert.equal(rows[0].likes,8);assert.equal(rows[0].lastModified,info.lastModified);
  assert.ok(sent[0].includes('full=true'));assert.ok(!sent.join('').includes('Private fixture'));assert.ok(!sent.join('').includes('hardware'));
});

test('forget or disable during scanning prevents a late result from restoring hardware details', async t => {
  let resolve; const s = await fixture(t, { hardwareScanner: () => new Promise(r => { resolve = r; }) });
  await s.settings({ hardwareRecommendations: true });
  const scan = s.scanHardware(); await assert.rejects(s.scanHardware(), /already/);
  s.forgetHardware(); resolve(profile()); await scan; assert.equal(s.snapshot().hardwareProfile, null);
  const again = s.scanHardware(); await s.settings({ hardwareRecommendations: false }); resolve(profile()); await again;
  assert.equal(s.snapshot().hardwareProfile, null); assert.equal(s.snapshot().hardwareScanning, false);
});

test('GPU parsing retains only supported names and bounded memory values, including shared-memory status', () => {
  const result = parseDevices('Available devices:\n  Vulkan0: Example GPU (12288 MiB, 10240 MiB free)\n  Vulkan1: Shared GPU (4096 MiB, 2048 MiB free)\n  Vulkan2: Bad (1 MiB, 900 MiB free)\n  RPC0: remote:5000 (90000 MiB, 90000 MiB free)', 'ggml_vulkan: 0 = Example GPU (driver) | uma: 0 | serial: ignored\nggml_vulkan: 1 = Shared GPU (driver) | uma: 1');
  assert.equal(result.length, 2); assert.equal(result[0].total, 12 * GiB); assert.equal(result[0].shared, false); assert.equal(result[1].shared, true);
  assert.ok(!JSON.stringify(result).includes('serial')); assert.ok(!JSON.stringify(result).includes('RPC'));
});

test('compatibility accounts for context, stale snapshots, CPU mode, unsupported files and incomplete metadata', () => {
  assert.equal(modelCompatibility(file, profile(), settings).level, 'good');
  assert.ok(memoryEstimate(file, 32768).bytes > memoryEstimate(file, 8192).bytes);
  assert.equal(modelCompatibility({ ...file, memory: { ...metadata, architecture: 'unknown' } }, profile(), settings).level, 'unknown');
  assert.equal(modelCompatibility(file, profile(), { ...settings, hardwareRecommendations: false }).label, 'Hardware check off');
  assert.equal(modelCompatibility(file, { ...profile(), scannedAt: Date.now() - HARDWARE_MAX_AGE - 1 }, settings).label, 'Refresh scan');
  assert.equal(modelCompatibility(file, profile(), { ...settings, acceleration: 'cpu' }).label, 'CPU memory fits');
  assert.equal(modelCompatibility({ ...file, split: true }, profile(), settings).level, 'unsupported');
  assert.equal(modelCompatibility(file, { ...profile(), gpus: [], gpuStatus: 'unknown' }, settings).level, 'unknown');
  const lowDisk = profile(); lowDisk.disk.available = GiB;
  assert.equal(modelCompatibility(file, lowDisk, settings).level, 'disk');
  assert.notEqual(modelCompatibility({ ...file, installed: true }, lowDisk, settings).level, 'disk');
});

test('shared memory and multiple GPUs are not added to RAM or combined into an optimistic fit', () => {
  const p = profile(); p.memory.available = 5 * GiB; p.gpus[0].shared = true;
  assert.notEqual(modelCompatibility(file, p, settings).level, 'good');
  p.gpus = [{ available: 4 * GiB, total: 4 * GiB, shared: false }, { available: 4 * GiB, total: 4 * GiB, shared: false }];
  assert.notEqual(modelCompatibility(file, p, settings).level, 'good');
});

test('download chooser handles missing preferred quantizations without duplicating or selecting unsupported files', () => {
  const row = (name, size, extra = {}) => ({ name, size, sha256: 'b'.repeat(64), ...extra });
  const files = [row('m-Q4_K_M.gguf', 4), row('m-Q3_K_M.gguf', 3), row('m-Q5_K_M.gguf', 5), row('mmproj-F16.gguf', 1, { projector: true }), row('split-Q8_0.gguf', 2, { split: true })];
  assert.deepEqual(chooseVariants(files).map(v => v.file.size), [4,3,5]);
  assert.equal(chooseVariants([files[2]]).length, 1); assert.equal(chooseVariants([files[3],files[4]]).length, 0);
  assert.equal(quantizationName('model-Q4_K_M.gguf'), 'Q4_K_M'); assert.equal(quantizationName('model-BF16.gguf'), 'BF16');
});

test('GGUF preview reads bounded headers and extracts cache metadata without downloading tensors', async () => {
  const bytes = gguf({ 'tokenizer.padding': 'x'.repeat(70000) });
  let requests = 0;
  const result = await previewGGUF('https://huggingface.co/fixture', bytes.length + 100000, async (_url, options) => {
    requests++; const end = Number(options.headers.Range.split('-')[1]);
    const chunk = Buffer.alloc(end + 1); bytes.copy(chunk);
    return new Response(chunk, { status: 206, headers: { 'content-range': `bytes 0-${end}/${bytes.length + 100000}` } });
  });
  assert.equal(requests, 2); assert.deepEqual(result.memory, { ...metadata, keyLength: null, valueLength: null, slidingWindow: null });
  assert.equal(memoryMetadata(parseGGUFMetadata(gguf())).layers, 32);
  await assert.rejects(async () => parseGGUFMetadata(Buffer.from('GGUF')), { code: 'GGUF_HEADER_INCOMPLETE' });
});

test('servers ignoring Range or returning oversized/mismatched data produce unknown estimates', async () => {
  let cancelled = false;
  const noRange = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  assert.equal((await previewGGUF('https://huggingface.co/fixture', 10 ** 10, async () => noRange)).metadataError, 'unavailable'); assert.equal(cancelled, true);
  assert.equal((await previewGGUF('https://huggingface.co/fixture', 8, async () => new Response('0123456789', { status: 206, headers: { 'content-range': 'bytes 0-7/8' } }))).metadataError, 'unavailable');
  assert.equal((await previewGGUF('https://huggingface.co/fixture', 8, async () => new Response('abcdefgh', { status: 206, headers: { 'content-range': 'bytes 0-7/8' } }))).metadataError, 'format');
});

test('Hub preview is offline-aware, revision-pinned, and never transmits hardware details', async t => {
  const s = await fixture(t, { hardwareScanner: async () => profile() });
  const request = { repo: 'publisher/example', filename: 'example-Q4_K_M.gguf', revision };
  await s.settings({ hardwareRecommendations: true }); await s.scanHardware();
  await assert.rejects(s.previewModel(request), /Offline/);
  const original = global.fetch; t.after(() => { global.fetch = original; });
  const bytes = gguf(); const sent = [];
  global.fetch = async (url, options) => {
    sent.push(JSON.stringify({ url, options }));
    if (url.includes('/api/models/')) return Response.json({ id: request.repo, sha: revision, siblings: [{ rfilename: request.filename, size: bytes.length, lfs: { sha256: 'b'.repeat(64) } }] });
    assert.ok(url.includes('/' + revision + '/'));
    return new Response(bytes, { status: 206, headers: { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` } });
  };
  await s.settings({ offline: false }); const result = await s.previewModel(request); assert.equal(result.memory.architecture, 'llama');
  assert.ok(!sent.join('').includes('Private fixture')); assert.ok(!sent.join('').includes('hardware'));
  await assert.rejects(s.previewModel({ ...request, revision: 'c'.repeat(40) }), /repository changed/);
  await assert.rejects(s.startDownload({ ...request, revision: 'c'.repeat(40) }), /repository changed/);
  s.previewCache.clear(); let previewCalls = 0;
  const completeFetch = global.fetch;
  global.fetch = async (url, options) => { if (url.includes('/api/models/')) return completeFetch(url, options); previewCalls++; return new Response('Range not supported'); };
  assert.equal((await s.previewModel(request)).metadataError, 'unavailable');
  await s.previewModel(request); assert.equal(previewCalls, 2, 'Transient metadata failures remain retryable');
  await s.settings({ offline: true }); await assert.rejects(s.previewModel(request), /Offline/);
});
