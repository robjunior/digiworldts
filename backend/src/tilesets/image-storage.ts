import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TILESETS_DIR = resolve(__dirname, '../../data/tilesets');

async function ensureDir(): Promise<void> {
  await fs.mkdir(TILESETS_DIR, { recursive: true });
}

export function getTilesetImagePath(tilesetId: string): string {
  return join(TILESETS_DIR, `${tilesetId}.png`);
}

export async function writeTilesetImage(tilesetId: string, data: Buffer): Promise<void> {
  await ensureDir();
  await fs.writeFile(getTilesetImagePath(tilesetId), data);
}

export async function readTilesetImage(tilesetId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(getTilesetImagePath(tilesetId));
  } catch {
    return null;
  }
}

export async function deleteTilesetImage(tilesetId: string): Promise<void> {
  await fs.rm(getTilesetImagePath(tilesetId), { force: true });
}

/**
 * Parse width + height from the first 24 bytes of a PNG file. PNG format:
 * 8-byte signature (89 50 4E 47 0D 0A 1A 0A), then the IHDR chunk whose
 * data section (starting at byte 16) begins with 4-byte big-endian width
 * and 4-byte big-endian height. Returns `null` for anything that isn't a
 * valid PNG — the upload route should reject the file with a 400.
 */
export function parsePngDimensions(buffer: Buffer): { readonly width: number; readonly height: number } | null {
  if (buffer.length < 24) return null;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  if (!isPng) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}
