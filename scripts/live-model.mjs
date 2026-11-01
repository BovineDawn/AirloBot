import path from 'node:path';

// Each live test owns an isolated engine and state directory. No external server.
export async function loadLiveModel(service) {
  const filename = process.argv[2];
  if (!filename || filename.startsWith('--')) throw new Error('Pass a local GGUF path as the first argument.');
  await service.init();
  const model = await service.registerModel(path.resolve(filename));
  await service.settings({ offline: true });
  await service.loadModel(model.key);
  return model;
}
