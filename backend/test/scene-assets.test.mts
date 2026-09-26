import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

import { writeSceneRevision } from '../src/scenes/assets.js';

const project = Buffer.from(JSON.stringify({
  metadata: {},
  project: { renderer: 'WebGLRenderer' },
  camera: { object: { type: 'PerspectiveCamera' } },
  scene: { object: { type: 'Scene' } },
  controls: {},
  history: {},
}));
const glb = Buffer.alloc(20);
glb.write('glTF', 0, 'ascii');
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(glb.length, 8);

const root = await mkdtemp(join(tmpdir(), 'dw-scene-assets-'));
try {
  const uploaded = await writeSceneRevision(root, 'scn_0123456789abcdefghjkmnpqrs', project, glb);
  assert.equal(uploaded.projectUrl, `/assets/scenes/${uploaded.sceneId}/${uploaded.revision}/project.app.json`);
  assert.equal(uploaded.modelUrl, `/assets/scenes/${uploaded.sceneId}/${uploaded.revision}/scene.glb`);
  assert.equal((await readFile(join(root, uploaded.sceneId, uploaded.revision, 'project.app.json'))).toString(), project.toString());
  assert.deepEqual(await readFile(join(root, uploaded.sceneId, uploaded.revision, 'scene.glb')), glb);
  assert.equal(uploaded.projectSha256.length, 64);
  assert.equal(uploaded.modelSha256.length, 64);

  await assert.rejects(() => writeSceneRevision(root, '../escape', project, glb), /scene id/i);
  await assert.rejects(() => writeSceneRevision(root, 'scn_0123456789abcdefghjkmnpqrs', Buffer.from('{"scene":{}}'), glb), /project/i);
  const badGlb = Buffer.from(glb);
  badGlb.write('nope');
  await assert.rejects(() => writeSceneRevision(root, 'scn_0123456789abcdefghjkmnpqrs', project, badGlb), /glb/i);
  console.log('scene assets: valid paired revision, hashes, and invalid inputs passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
