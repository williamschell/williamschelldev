// Pulls the main colors out of a drawing, to turn what's on screen into a palette. Pure.

const MIN_ALPHA = 64; // fainter pixels are stroke edges, and their colors aren't reliable
const MIN_SHARE = 0.002; // rarer colors are blends where strokes overlap, not real choices
const MIN_DISTANCE = 56; // closer colors look the same as a swatch

const toHex = (value) => `#${value.toString(16).padStart(6, '0')}`;

/** Straight-line distance between two 0xrrggbb colors in RGB space. */
function distance(a, b) {
  const dr = (a >> 16) - (b >> 16);
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
  const db = (a & 255) - (b & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Finds the most used distinct colors. Pixels are grouped into coarse buckets so that a color
 * and its near-identical edge pixels count together. Each bucket is then represented by its
 * most common exact color, so a swatch matches the color that was actually drawn, not an average.
 *
 * @param {Uint8ClampedArray} pixels RGBA data
 * @param {{ max?: number, step?: number }} [options] step samples every nth pixel
 * @returns {string[]} hex colors, most used first
 */
export function extractPalette(pixels, { max = 8, step = 2 } = {}) {
  const exact = new Map();
  for (let i = 0; i < pixels.length; i += 4 * step) {
    if (pixels[i + 3] < MIN_ALPHA) continue;
    const color = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    exact.set(color, (exact.get(color) ?? 0) + 1);
  }

  const buckets = new Map();
  let total = 0;
  for (const [color, count] of exact) {
    total += count;
    const key = color & 0xf0f0f0;
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { count, color, top: count });
    } else {
      bucket.count += count;
      if (count > bucket.top) {
        bucket.top = count;
        bucket.color = color;
      }
    }
  }

  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
  const chosen = [];
  for (const { count, color } of ranked) {
    if (chosen.length >= max || count < total * MIN_SHARE) break;
    if (chosen.every((other) => distance(other, color) >= MIN_DISTANCE)) chosen.push(color);
  }
  return chosen.map(toHex);
}
