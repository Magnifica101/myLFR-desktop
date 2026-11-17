import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCEPTED_LOGO_TYPES, prepareLogo, scaledSize } from './logo';

describe('logo sizing', () => {
  it('shrinks the long edge and keeps the aspect ratio', () => {
    expect(scaledSize(3000, 1500, 600)).toEqual({ width: 600, height: 300 });
    expect(scaledSize(1200, 2400, 600)).toEqual({ width: 300, height: 600 });
  });

  it('leaves an already small logo untouched', () => {
    expect(scaledSize(220, 80, 600)).toEqual({ width: 220, height: 80 });
  });

  it('never rounds an extreme aspect ratio down to zero', () => {
    expect(scaledSize(6000, 20, 600).height).toBe(2);
  });
});

describe('prepareLogo', () => {
  it('rejects a file that is not a PNG or JPEG', async () => {
    const file = new File(['not an image'], 'logo.gif', { type: 'image/gif' });
    await expect(prepareLogo(file)).rejects.toThrow('PNG or JPEG');
  });

  it('rejects a source image over 10 MB before decoding it', async () => {
    const file = new File([new Uint8Array(11 * 1024 * 1024)], 'logo.png', { type: 'image/png' });
    await expect(prepareLogo(file)).rejects.toThrow('smaller than 10 MB');
  });

  it('accepts exactly the formats the file picker offers', () => {
    expect(ACCEPTED_LOGO_TYPES).toEqual(['image/png', 'image/jpeg']);
  });
});

/**
 * jsdom has no canvas encoder, so the encode path is driven through stubs. The
 * stub records every draw so a test can assert how many encodes actually ran,
 * and returns a blob of `blobBytes` so the size cap can be steered.
 */
function stubCanvas(blobBytes: number) {
  const draws: Array<{ width: number; height: number }> = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = createElement(tag) as HTMLCanvasElement;
    if (tag !== 'canvas') return element;
    element.getContext = (() => ({ drawImage: () => {} })) as never;
    element.toBlob = ((callback: (blob: Blob) => void) => {
      draws.push({ width: element.width, height: element.height });
      callback(new Blob([new Uint8Array(blobBytes)], { type: 'image/png' }));
    }) as never;
    return element;
  });
  return draws;
}

function stubBitmap(width: number, height: number) {
  vi.stubGlobal('createImageBitmap', async () => ({ width, height, close: () => {} }));
}

describe('prepareLogo encode attempts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('encodes a source smaller than every target exactly once', async () => {
    // 220x80 is smaller than every entry in EDGE_ATTEMPTS, so scaledSize
    // returns the same dimensions three times. Forcing every encode over the
    // cap keeps the loop running to exhaustion, which is the only way the
    // repeated attempts become observable: with a blob under the cap the first
    // attempt returns and the duplicates never happen anyway.
    stubBitmap(220, 80);
    const draws = stubCanvas(600 * 1024);

    await expect(
      prepareLogo(new File(['x'], 'logo.png', { type: 'image/png' })),
    ).rejects.toThrow('too detailed');

    expect(draws).toEqual([{ width: 220, height: 80 }]);
  });

  it('returns the first encode that fits, without scaling a small logo', async () => {
    stubBitmap(220, 80);
    const draws = stubCanvas(1024);

    const logo = await prepareLogo(new File(['x'], 'logo.png', { type: 'image/png' }));

    expect(draws).toEqual([{ width: 220, height: 80 }]);
    expect(logo).toMatchObject({ width: 220, height: 80 });
  });

  it('still encodes once per distinct size when the first attempt is too large', async () => {
    // 3000x1500 scales differently at each target, so no attempt is skipped.
    // Every encode exceeds the cap, so the loop exhausts and reports failure.
    stubBitmap(3000, 1500);
    const draws = stubCanvas(600 * 1024);

    await expect(
      prepareLogo(new File(['x'], 'logo.png', { type: 'image/png' })),
    ).rejects.toThrow('too detailed');

    expect(draws).toEqual([
      { width: 600, height: 300 },
      { width: 400, height: 200 },
      { width: 300, height: 150 },
    ]);
  });

  it('skips only the repeated sizes when the source sits between two targets', async () => {
    // 500x500 clamps to 500 at the 600 target, then scales to 400 and 300. Only
    // the first attempt is a no-op downscale, and none of the three repeat.
    stubBitmap(500, 500);
    const draws = stubCanvas(600 * 1024);

    await expect(
      prepareLogo(new File(['x'], 'logo.png', { type: 'image/png' })),
    ).rejects.toThrow('too detailed');

    expect(draws).toEqual([
      { width: 500, height: 500 },
      { width: 400, height: 400 },
      { width: 300, height: 300 },
    ]);
  });
});
