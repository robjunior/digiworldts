/**
 * Minimal GIF decoder for the digimon overworld dots (16×16, 2 frames,
 * global color table, GCE transparency, non-interlaced). Phaser renders
 * only the first frame of an animated GIF, so the walk cycle is restored by
 * decoding the frames here and registering them as a spritesheet texture.
 * Returns null for anything it cannot decode (caller falls back to the
 * static single-frame texture).
 */

export type DecodedGif = {
  readonly frames: readonly ImageData[];
  readonly width: number;
  readonly height: number;
  /** Frame delay in ms (from the first GCE). */
  readonly delayMs: number;
};

function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array | null {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let table = new Map<number, number[]>();
  for (let i = 0; i < clearCode; i++) table.set(i, [i]);
  let nextCode = endCode + 1;
  const out: number[] = [];
  let prev: number[] | null = null;
  let bitPos = 0;

  const readCode = (): number => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIndex = bitPos >> 3;
      if (byteIndex >= data.length) return -1;
      const byte = data[byteIndex];
      if (byte === undefined) return -1;
      code |= ((byte >> (bitPos & 7)) & 1) << i;
      bitPos += 1;
    }
    return code;
  };

  for (;;) {
    if (out.length >= pixelCount) break;
    const code = readCode();
    if (code < 0) break;
    if (code === clearCode) {
      table = new Map<number, number[]>();
      for (let i = 0; i < clearCode; i++) table.set(i, [i]);
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
      prev = null;
      continue;
    }
    if (code === endCode) break;
    let entry: number[] | undefined = table.get(code);
    if (entry === undefined) {
      if (prev !== null && code === nextCode) {
        const firstPrev: number | undefined = prev[0];
        if (firstPrev === undefined) return null;
        entry = [...prev, firstPrev];
      } else {
        return null;
      }
    }
    if (entry === undefined) return null;
    out.push(...entry);
    if (prev !== null && nextCode < 4096) {
      const first = entry[0];
      if (first === undefined) return null;
      table.set(nextCode, [...prev, first]);
      nextCode += 1;
      // GIF "early change": the code width grows the moment the table size
      // reaches 2^codeSize, not one entry later.
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    prev = entry;
  }
  return Uint8Array.from(out.slice(0, pixelCount));
}

export function decodeGifFrames(buffer: ArrayBufferLike): DecodedGif | null {
  const data = new Uint8Array(buffer);
  if (data.length < 14 || data[0] !== 0x47 || data[1] !== 0x49 || data[2] !== 0x46) return null;
  // Bounded reader: out-of-bounds = corrupt file → the catch below returns null.
  const byte = (i: number): number => {
    const v = data[i];
    if (v === undefined) throw new Error('gif: out of bounds');
    return v;
  };
  const readU16 = (offset: number): number => byte(offset) | (byte(offset + 1) << 8);
  try {
    const width = readU16(6);
    const height = readU16(8);
    const packed = byte(10);
    const hasGct = (packed & 0x80) !== 0;
    const gctSize = 2 << (packed & 7);
    let pos = 13;
    const palette: [number, number, number][] = [];
    if (hasGct) {
      for (let i = 0; i < gctSize; i++) {
        palette.push([byte(pos), byte(pos + 1), byte(pos + 2)]);
        pos += 3;
      }
    }

    const frames: ImageData[] = [];
    let delayMs = 250;
    let transparentIndex = -1;

    while (pos < data.length) {
      const block = byte(pos);
      if (block === 0x21) {
        const label = byte(pos + 1);
        if (label === 0xf9) {
          const size = byte(pos + 2);
          const flags = byte(pos + 3);
          const rawDelay = byte(pos + 4) | (byte(pos + 5) << 8);
          delayMs = Math.max(10, rawDelay * 10 || 100);
          transparentIndex = (flags & 1) !== 0 ? byte(pos + 6) : -1;
          pos += 3 + size;
          if (byte(pos) === 0) pos += 1;
        } else {
          pos += 2;
          let n = byte(pos);
          while (n !== 0) {
            pos += 1 + n;
            n = byte(pos);
          }
          pos += 1;
        }
      } else if (block === 0x2c) {
        const ix = readU16(pos + 1);
        const iy = readU16(pos + 3);
        const iw = readU16(pos + 5);
        const ih = readU16(pos + 7);
        const imagePacked = byte(pos + 9);
        const interlaced = (imagePacked & 0x40) !== 0;
        const hasLct = (imagePacked & 0x80) !== 0;
        pos += 10;
        if (interlaced) return null;
        const localPalette: [number, number, number][] = hasLct
          ? (() => {
              const size = 2 << (imagePacked & 7);
              const out: [number, number, number][] = [];
              for (let i = 0; i < size; i++) {
                out.push([byte(pos), byte(pos + 1), byte(pos + 2)]);
                pos += 3;
              }
              return out;
            })()
          : palette;
        const minCodeSize = byte(pos);
        pos += 1;
        const blocks: number[] = [];
        for (;;) {
          const n = byte(pos);
          pos += 1;
          if (n === 0) break;
          for (let i = 0; i < n; i++) blocks.push(byte(pos + i));
          pos += n;
        }
        const indices = lzwDecode(Uint8Array.from(blocks), minCodeSize, iw * ih);
        if (indices === null) return null;
        const img = new ImageData(iw, ih);
        for (let p = 0; p < iw * ih; p++) {
          const ci = indices[p];
          const o = p * 4;
          if (ci === undefined || ci === transparentIndex) continue;
          const color = localPalette[ci];
          if (color === undefined) continue;
          img.data[o] = color[0];
          img.data[o + 1] = color[1];
          img.data[o + 2] = color[2];
          img.data[o + 3] = 255;
        }
        if (ix !== 0 || iy !== 0) return null;
        frames.push(img);
      } else if (block === 0x3b) {
        break;
      } else {
        return null;
      }
    }

    if (frames.length === 0) return null;
    return { frames, width, height, delayMs };
  } catch {
    return null;
  }
}
