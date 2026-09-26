import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_SCENE_PROJECT_BYTES = 64 * 1024 * 1024;
export const MAX_SCENE_GLB_BYTES = 128 * 1024 * 1024;

const SCENE_ID = /^scn_[0-9a-hjkmnp-tv-z]{26}$/;

export type SceneAssetRevision = {
  readonly sceneId: string;
  readonly revision: string;
  readonly projectUrl: string;
  readonly modelUrl: string;
  readonly projectSha256: string;
  readonly modelSha256: string;
  readonly projectBytes: number;
  readonly modelBytes: number;
};

function validateProject(projectBytes: Buffer): void {
  if (projectBytes.byteLength === 0 || projectBytes.byteLength > MAX_SCENE_PROJECT_BYTES) {
    throw new Error('Invalid editor project size');
  }
  let project: unknown;
  try {
    project = JSON.parse(projectBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('Invalid editor project JSON');
  }
  if (typeof project !== 'object' || project === null || Array.isArray(project)) {
    throw new Error('Invalid editor project document');
  }
  const record = project as Record<string, unknown>;
  if (typeof record['scene'] !== 'object' || record['scene'] === null
    || typeof record['camera'] !== 'object' || record['camera'] === null) {
    throw new Error('Invalid editor project document');
  }
}

function validateGlb(glbBytes: Buffer): void {
  if (glbBytes.byteLength < 12 || glbBytes.byteLength > MAX_SCENE_GLB_BYTES) {
    throw new Error('Invalid GLB size');
  }
  if (glbBytes.toString('ascii', 0, 4) !== 'glTF'
    || glbBytes.readUInt32LE(4) !== 2
    || glbBytes.readUInt32LE(8) !== glbBytes.byteLength) {
    throw new Error('Invalid GLB header');
  }
}

async function writeSynced(path: string, data: Buffer): Promise<void> {
  const file = await open(path, 'wx', 0o640);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function writeSceneRevision(
  assetsRoot: string,
  sceneId: string,
  projectBytes: Buffer,
  glbBytes: Buffer,
): Promise<SceneAssetRevision> {
  if (!SCENE_ID.test(sceneId)) throw new Error('Invalid scene id');
  validateProject(projectBytes);
  validateGlb(glbBytes);

  const sceneRoot = join(assetsRoot, sceneId);
  await mkdir(sceneRoot, { recursive: true });
  const revision = `rev_${randomUUID().replaceAll('-', '')}`;
  const staging = join(sceneRoot, `.tmp-${revision}`);
  const destination = join(sceneRoot, revision);
  await mkdir(staging, { recursive: false });
  try {
    await writeSynced(join(staging, 'project.app.json'), projectBytes);
    await writeSynced(join(staging, 'scene.glb'), glbBytes);
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  return {
    sceneId,
    revision,
    projectUrl: `/assets/scenes/${sceneId}/${revision}/project.app.json`,
    modelUrl: `/assets/scenes/${sceneId}/${revision}/scene.glb`,
    projectSha256: createHash('sha256').update(projectBytes).digest('hex'),
    modelSha256: createHash('sha256').update(glbBytes).digest('hex'),
    projectBytes: projectBytes.byteLength,
    modelBytes: glbBytes.byteLength,
  };
}
