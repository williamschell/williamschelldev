// 2D value noise. Uses arithmetic only (no sin, cos or pow), so it stays
// bit-identical across browsers.

const SIZE = 256;
const MASK = SIZE - 1;

/**
 * Builds a noise function from an rng: a shuffled permutation table over a table
 * of random lattice values.
 * @param {import('./rng.js').Rng} rng
 * @returns {{ noise: (x: number, y: number) => number, fbm: (x: number, y: number, octaves?: number) => number }}
 */
export function createNoise(rng) {
  const values = new Float64Array(SIZE);
  const perm = new Uint8Array(SIZE * 2);
  for (let i = 0; i < SIZE; i++) {
    values[i] = rng.next() * 2 - 1;
    perm[i] = i;
  }
  for (let i = SIZE - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < SIZE; i++) perm[i + SIZE] = perm[i];

  // Quintic fade 6t^5 - 15t^4 + 10t^3: its first and second derivatives are zero
  // at both ends, so the lattice grid doesn't show up as creases in the warp.
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  /** Value noise in [-1, 1]. */
  const noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const X = xi & MASK;
    const Y = yi & MASK;
    const Y1 = (Y + 1) & MASK;
    // Hash the four corners of this lattice cell, then blend them bilinearly.
    const aa = values[perm[perm[X] + Y]];
    const ba = values[perm[perm[X + 1] + Y]];
    const ab = values[perm[perm[X] + Y1]];
    const bb = values[perm[perm[X + 1] + Y1]];
    const top = aa + (ba - aa) * u;
    const bottom = ab + (bb - ab) * u;
    return top + (bottom - top) * v;
  };

  /** Fractal sum: each octave doubles the frequency and halves the amplitude. */
  const fbm = (x, y, octaves = 2) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(fx, fy);
      norm += amp;
      amp *= 0.5;
      fx = fx * 2 + 17.3;
      fy = fy * 2 + 9.1;
    }
    return sum / norm;
  };

  return { noise, fbm };
}
