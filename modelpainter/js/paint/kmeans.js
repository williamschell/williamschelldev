// K-means palette extraction. Pure, and run from the data worker.

import { createRng } from '../../../splotchle/js/rng.js';

const MIN_ALPHA = 64; // fainter pixels are stroke edges, and their colors aren't reliable
const MAX_SAMPLES = 40000;
const ITERATIONS = 16;

/**
 * Finds the N colors that best describe an image. Starting points are chosen k-means++ style, so
 * each new one is likely to be far from those already picked. That finds small but striking accent
 * colors that a plain "most common colors" count would average away. A fixed seed means the same
 * image always gives the same palette.
 *
 * @param {Uint8Array|Uint8ClampedArray} pixels RGBA
 * @param {number} colors how many colors to find
 * @returns {string[]} hex colors, largest cluster first
 */
export function kmeansPalette(pixels, colors) {
  const rng = createRng('palette');
  const count = pixels.length / 4;
  const step = Math.max(1, Math.floor(count / MAX_SAMPLES));
  const samples = [];
  for (let i = 0; i < count; i += step) {
    if (pixels[i * 4 + 3] < MIN_ALPHA) continue;
    samples.push(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
  }
  const n = samples.length / 3;
  if (n === 0) return [];

  const k = Math.min(colors, n);
  const centers = new Float64Array(k * 3);
  const distances = new Float64Array(n).fill(Infinity);
  const first = Math.floor(rng.next() * n);
  centers.set([samples[first * 3], samples[first * 3 + 1], samples[first * 3 + 2]], 0);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = squaredDistance(samples, i, centers, c - 1);
      if (d < distances[i]) distances[i] = d;
      sum += distances[i];
    }
    let pick = rng.next() * sum;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      pick -= distances[i];
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
    centers.set([samples[chosen * 3], samples[chosen * 3 + 1], samples[chosen * 3 + 2]], c * 3);
  }

  const sums = new Float64Array(k * 3);
  const sizes = new Uint32Array(k);
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    sums.fill(0);
    sizes.fill(0);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < k; c++) {
        const d = squaredDistance(samples, i, centers, c);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      sums[best * 3] += samples[i * 3];
      sums[best * 3 + 1] += samples[i * 3 + 1];
      sums[best * 3 + 2] += samples[i * 3 + 2];
      sizes[best]++;
    }
    for (let c = 0; c < k; c++) {
      if (sizes[c] === 0) continue;
      for (let j = 0; j < 3; j++) centers[c * 3 + j] = sums[c * 3 + j] / sizes[c];
    }
  }

  const order = [...sizes.keys()].filter((c) => sizes[c] > 0).sort((a, b) => sizes[b] - sizes[a]);
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  const seen = new Set();
  for (const c of order) seen.add(`#${hex(centers[c * 3])}${hex(centers[c * 3 + 1])}${hex(centers[c * 3 + 2])}`);
  return [...seen];
}

function squaredDistance(samples, i, centers, c) {
  const dr = samples[i * 3] - centers[c * 3];
  const dg = samples[i * 3 + 1] - centers[c * 3 + 1];
  const db = samples[i * 3 + 2] - centers[c * 3 + 2];
  return dr * dr + dg * dg + db * db;
}
