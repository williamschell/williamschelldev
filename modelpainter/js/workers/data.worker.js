// Slow data jobs that shouldn't block painting: encoding PNGs, zipping and unzipping project files,
// and k-means for the palette grabber. Each message is { id, job, ...args } and gets one reply.

import { unzipSync, zipSync } from '../../vendor/fflate/browser.js';
import { kmeansPalette } from '../paint/kmeans.js';

/** RGBA bytes to PNG. Passes store straight alpha, which is also what ImageData takes. */
async function encodePng({ pixels, width, height }) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

const jobs = {
  encodePng,
  zip: ({ files }) => zipSync(files, { level: 0 }), // PNG and GLB barely shrink further
  unzip: ({ bytes }) => unzipSync(bytes),
  palette: ({ pixels, colors }) => kmeansPalette(pixels, colors),
};

/** Buffers that can move back to the main thread instead of being copied. */
function transferList(result) {
  if (result instanceof Uint8Array) return [result.buffer];
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return Object.values(result).filter((v) => v instanceof Uint8Array).map((v) => v.buffer);
  }
  return [];
}

self.addEventListener('message', async ({ data }) => {
  const { id, job, ...args } = data;
  try {
    const result = await jobs[job](args);
    self.postMessage({ id, result }, transferList(result));
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
});
