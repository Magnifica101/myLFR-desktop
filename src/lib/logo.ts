import { toBase64 } from './format';
import type { BusinessLogo } from './types';

/** Refuse a source file this large before spending memory decoding it. */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
/** Must match the cap Rust enforces at the command boundary. */
const MAX_STORED_BYTES = 512 * 1024;
/** Long-edge targets, tried in order until the encoded PNG fits the cap. */
const EDGE_ATTEMPTS = [600, 400, 300];

export const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg'];

/**
 * Longest-edge downscale that never enlarges a small logo. Split out from the
 * canvas work so the arithmetic can be tested on its own.
 */
export function scaledSize(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Turn a chosen image file into the small PNG the app stores. Normalising to
 * PNG here keeps transparent backgrounds intact and leaves Rust with a single
 * format to validate, and shrinking once at upload keeps every exported PDF —
 * and every backup — small.
 */
export async function prepareLogo(file: File): Promise<BusinessLogo> {
  if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
    throw new Error('Choose a PNG or JPEG image.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Choose an image smaller than 10 MB.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That image could not be read.');
  }

  try {
    let lastAttempted: { width: number; height: number } | undefined;
    for (const maxEdge of EDGE_ATTEMPTS) {
      const size = scaledSize(bitmap.width, bitmap.height, maxEdge);
      // scaledSize never enlarges, so a source already smaller than the target
      // yields the same dimensions on every remaining attempt. Re-encoding
      // those would redo identical canvas work and produce an identical PNG.
      if (
        lastAttempted &&
        size.width === lastAttempted.width &&
        size.height === lastAttempted.height
      ) {
        continue;
      }
      lastAttempted = size;
      const blob = await drawToPng(bitmap, size.width, size.height);
      if (blob.size <= MAX_STORED_BYTES) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return { dataBase64: toBase64(bytes), width: size.width, height: size.height };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error('That image is too detailed to use as a logo. Try a simpler one.');
}

async function drawToPng(bitmap: ImageBitmap, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('That image could not be resized.');
  context.drawImage(bitmap, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('That image could not be resized.'))),
      'image/png',
    );
  });
}
