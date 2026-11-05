// The scalar field f(x, y) that the blob is the level set of.
//
// Each metaball uses the Wyvill falloff
//   g(d) = w * (1 - d^2 / R^2)^3   for d < R, otherwise 0
// rather than the classic r^2 / d^2, for two reasons: it has no singularity at the
// center, and it reaches exactly zero at R, so a small protrusion or hole only
// changes the field nearby. It also never needs a square root per sample.
//
// Where balls overlap, their fields add. Near a neighbour the level set bulges out
// to meet it, and that's what gives the shape its gooey, liquid necks.

import { createNoise } from './noise.js';

/** The iso-value of the blob's edge. */
export const THRESHOLD = 0.35;

// A lone ball of weight 1 crosses the threshold where (1 - q)^3 = T, with
// q = d^2 / R^2. For T = 0.35: 1 - q = 0.70473, q = 0.29527, d/R = sqrt(q) = 0.5434.
// This is a precomputed constant because Math.cbrt isn't guaranteed bit-identical
// across engines.
const VISIBLE_RATIO = 0.5434;

// The same idea for a hole with weight about 2 * (f - T): (1 - q)^3 = 0.45 gives d/R = 0.484.
const HOLE_RATIO = 0.484;

// Twelve directions around a circle, written out for the same no-sin/cos reason.
const RING = [
  [1, 0], [0.866, 0.5], [0.5, 0.866], [0, 1], [-0.5, 0.866], [-0.866, 0.5],
  [-1, 0], [-0.866, -0.5], [-0.5, -0.866], [0, -1], [0.5, -0.866], [0.866, -0.5],
];

const addBall = (balls, x, y, visibleRadius, w = 1) => {
  const R = visibleRadius / VISIBLE_RATIO;
  balls.push({ x, y, R2: R * R, w });
};

const evaluate = (balls, x, y) => {
  let sum = 0;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    const dx = x - b.x;
    const dy = y - b.y;
    const q = (dx * dx + dy * dy) / b.R2;
    if (q < 1) {
      const t = 1 - q;
      sum += b.w * t * t * t;
    }
  }
  return sum;
};

/**
 * Main body: a chain of overlapping balls. Each new ball sits less than the sum of
 * the two visible radii from the previous one, so the chain is always connected.
 * Higher complexity turns the chain more sharply, which makes the shape less sausage-like.
 */
function addBody(balls, rng, params) {
  const count = params.lobes + rng.int(0, Math.round(params.complexity * 2));
  let [hx, hy] = rng.unit();
  let x = 0;
  let y = 0;
  let r = rng.range(0.26, 0.42);
  addBall(balls, x, y, r);
  for (let i = 1; i < count; i++) {
    const [jx, jy] = rng.unit();
    const wander = 0.5 + params.complexity;
    const nx = hx + jx * wander;
    const ny = hy + jy * wander;
    const len = Math.sqrt(nx * nx + ny * ny) || 1;
    hx = nx / len;
    hy = ny / len;
    const next = rng.range(0.16, 0.4);
    const dist = (r + next) * rng.range(0.55, 0.85);
    x += hx * dist;
    y += hy * dist;
    r = next;
    addBall(balls, x, y, r);
  }
}

/**
 * Protrusions: march outward from a body ball to find its edge, then place a small
 * ball just past it. Some get a second, smaller ball to become a tendril.
 */
function addProtrusions(balls, rng, params) {
  const bodyCount = balls.length;
  for (let k = 0; k < params.protrusions; k++) {
    const origin = balls[rng.int(0, bodyCount - 1)];
    const [dx, dy] = rng.unit();
    let t = 0;
    while (t < 4 && evaluate(balls, origin.x + dx * t, origin.y + dy * t) >= THRESHOLD) t += 0.02;
    const r = rng.range(0.05, 0.14) * (0.8 + params.complexity * 0.6);
    const push = t + r * rng.range(0.2, 0.9);
    const px = origin.x + dx * push;
    const py = origin.y + dy * push;
    addBall(balls, px, py, r);
    if (rng.chance(0.35 + params.complexity * 0.4)) {
      const [jx, jy] = rng.unit();
      const nx = dx + jx * 0.6;
      const ny = dy + jy * 0.6;
      const len = Math.sqrt(nx * nx + ny * ny) || 1;
      addBall(balls, px + (nx / len) * r * 1.1, py + (ny / len) * r * 1.1, r * 0.7);
    }
  }
}

/**
 * Holes: negative balls placed where the field is well above the threshold. A ring
 * of test points around each candidate checks that the hole stays clear of the edge.
 * If it doesn't, the hole shrinks. If it still doesn't fit, the candidate is dropped,
 * so the holes param is an upper bound rather than a promise.
 */
function addHoles(balls, rng, params) {
  if (params.holes === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of balls) {
    const r = Math.sqrt(b.R2) * VISIBLE_RATIO;
    minX = Math.min(minX, b.x - r);
    maxX = Math.max(maxX, b.x + r);
    minY = Math.min(minY, b.y - r);
    maxY = Math.max(maxY, b.y + r);
  }
  for (let h = 0; h < params.holes; h++) {
    const candidates = [];
    for (let i = 0; i < 96; i++) {
      const x = rng.range(minX, maxX);
      const y = rng.range(minY, maxY);
      const f = evaluate(balls, x, y);
      if (f > THRESHOLD * 2) candidates.push({ x, y, f });
    }
    candidates.sort((a, b) => b.f - a.f);
    let placed = false;
    for (let c = 0; c < Math.min(6, candidates.length) && !placed; c++) {
      const { x, y, f } = candidates[c];
      let r = rng.range(0.05, 0.12) * (0.8 + params.complexity);
      for (let attempt = 0; attempt < 3 && !placed; attempt++, r *= 0.75) {
        const clear = RING.every(
          ([dx, dy]) => evaluate(balls, x + dx * r * 1.6, y + dy * r * 1.6) > THRESHOLD + 0.1,
        );
        if (clear) {
          const R = r / HOLE_RATIO;
          balls.push({ x, y, R2: R * R, w: -((f - THRESHOLD) * 2 + 0.15) });
          placed = true;
        }
      }
    }
  }
}

/**
 * @typedef {object} Field
 * @property {(x: number, y: number) => number} sample field value at a point in [-1, 1]²
 * @property {number} threshold
 */

/**
 * Builds the field for a set of params. x and y are normalized to [-1, 1].
 * @param {import('./rng.js').Rng} rng
 * @param {import('./blob.js').BlobParams} params
 * @returns {Field}
 */
export function buildField(rng, params) {
  const balls = [];
  addBody(balls, rng, params);
  addProtrusions(balls, rng, params);
  addHoles(balls, rng, params);

  // Aspect stretches in both directions, so the overall area stays about the same.
  const a = Math.sqrt(params.aspect);

  // Fit the whole arrangement inside +-0.72 of the domain, which leaves room for the
  // warp below (at most +-0.23) without the shape ever reaching the grid boundary.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of balls) {
    if (b.w < 0) continue;
    // 1.35: neighbouring balls add up, so the real surface sits past the lone-ball radius.
    const r = Math.sqrt(b.R2) * VISIBLE_RATIO * 1.35;
    minX = Math.min(minX, (b.x - r) * a);
    maxX = Math.max(maxX, (b.x + r) * a);
    minY = Math.min(minY, (b.y - r) / a);
    maxY = Math.max(maxY, (b.y + r) / a);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = 0.72 / Math.max((maxX - minX) / 2, (maxY - minY) / 2);

  const { fbm } = createNoise(rng);
  const amplitude = 0.03 + 0.2 * params.complexity;
  const frequency = 1.4 + 1.6 * params.complexity;

  const sample = (x, y) => {
    // Domain warp: push each sample point around with two independent noise values.
    // That bends the whole level set smoothly, topology included, so a hole placed
    // above is still a hole afterwards.
    const wx = x + amplitude * fbm(x * frequency, y * frequency);
    const wy = y + amplitude * fbm(x * frequency + 5.2, y * frequency + 1.3);
    // Undo the fit and the aspect to get back into the space the balls live in.
    return evaluate(balls, (wx / scale + cx) / a, (wy / scale + cy) * a);
  };

  return { sample, threshold: THRESHOLD };
}
