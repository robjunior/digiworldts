import { SceneManager } from '../scene3d/scene';

const THUMB_SIZE = 512;
const RENDER_SETTLE_MS = 120;

async function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function generateArenaThumbnail(glbFile: File, arenaKey: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  host.style.top = '-99999px';
  host.style.width = `${THUMB_SIZE}px`;
  host.style.height = `${THUMB_SIZE}px`;
  host.style.pointerEvents = 'none';
  host.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  document.body.appendChild(host);

  const blobUrl = URL.createObjectURL(glbFile);
  let manager: SceneManager | null = null;
  try {
    manager = new SceneManager(canvas);
    manager.resize(THUMB_SIZE, THUMB_SIZE);
    await manager.loadArenaModelWithAtmosphere(blobUrl, arenaKey);
    await nextFrame();
    await sleep(RENDER_SETTLE_MS);
    manager.renderOnce();
    await nextFrame();
    manager.renderOnce();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob !== null) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      }, 'image/png');
    });
  } finally {
    manager?.dispose();
    URL.revokeObjectURL(blobUrl);
    host.remove();
  }
}
