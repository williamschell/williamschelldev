// generateBlob: { seed, params } -> geometry. Pure and deterministic.

import { createRng } from './rng.js';
import { buildField } from './field.js';
import { marchingSquares, selectLoops, simplifyLoop, chaikin, signedArea } from './contour.js';
import { loopsToPath } from './path.js';

/**
 * Bump this whenever generation output changes. Saved art stores the version it was
 * drawn on, so an old blob can't silently change shape underneath its drawing.
 */
export const GEN_VERSION = 1;

/** Logical size of the square artboard. */
export const ARTBOARD = 1024;

const PADDING = 104;
const MAX_ATTEMPTS = 6; // the original seed plus 5 retries

/**
 * @typedef {object} BlobParams
 * @property {number} complexity 0-1, noise strength and ball count
 * @property {number} lobes 1-6, main body balls
 * @property {number} holes 0-3, negative balls (an upper bound)
 * @property {number} protrusions 0-8, small edge balls
 * @property {number} aspect 0.5-2, overall stretch
 * @property {number} smoothness 0-1, Chaikin passes and RDP tolerance
 * @property {boolean} [multiPiece] keep extra islands
 */

/** @type {BlobParams} */
export const DEFAULT_PARAMS = Object.freeze({
  complexity: 0.5,
  lobes: 3,
  holes: 1,
  protrusions: 3,
  aspect: 1,
  smoothness: 0.6,
});

/** Named param sets. @type {Record<string, BlobParams>} */
export const PRESETS = Object.freeze({
  gentle: { complexity: 0.25, lobes: 2, holes: 0, protrusions: 1, aspect: 1, smoothness: 0.85 },
  weird: { complexity: 0.6, lobes: 3, holes: 1, protrusions: 4, aspect: 1, smoothness: 0.6 },
  cursed: { complexity: 1, lobes: 6, holes: 3, protrusions: 8, aspect: 1, smoothness: 0.3 },
});

/** Bold blob colors. A seed picks one, and the artist can change it. */
export const BLOB_COLORS = Object.freeze([
  '#ff5a36', '#2f6bff', '#12a150', '#a23ee8', '#ff2e88', '#00a3a3', '#f2a100', '#6b4eff',
]);

/**
 * The color a seed gets by default.
 * @param {string} seed
 * @returns {string}
 */
export function colorForSeed(seed) {
  return createRng(`${seed}-color`).pick([...BLOB_COLORS]);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Fills in defaults and clamps everything to its documented range.
 * @param {Partial<BlobParams>} [params]
 * @returns {BlobParams}
 */
export function normalizeParams(params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  return {
    complexity: clamp(Number(p.complexity) || 0, 0, 1),
    lobes: Math.round(clamp(Number(p.lobes) || 1, 1, 6)),
    holes: Math.round(clamp(Number(p.holes) || 0, 0, 3)),
    protrusions: Math.round(clamp(Number(p.protrusions) || 0, 0, 8)),
    aspect: clamp(Number(p.aspect) || 1, 0.5, 2),
    smoothness: clamp(Number(p.smoothness) || 0, 0, 1),
    multiPiece: Boolean(p.multiPiece),
  };
}

/** Monotone-chain convex hull, used to spot blobs that are basically circles. */
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** Scales loops uniformly to fit the artboard with padding, centered. */
function fitToArtboard(loops) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const scale = (ARTBOARD - PADDING * 2) / Math.max(maxX - minX, maxY - minY);
  const ox = ARTBOARD / 2 - ((minX + maxX) / 2) * scale;
  const oy = ARTBOARD / 2 - ((minY + maxY) / 2) * scale;
  const rounded = (n) => Math.round(n * 100) / 100;
  return loops.map((loop) => loop.map(([x, y]) => [rounded(x * scale + ox), rounded(y * scale + oy)]));
}

/** Smallest distance between any hole vertex and any outer vertex, or Infinity without holes. */
function holeClearance(outers, holes) {
  let best = Infinity;
  for (const hole of holes) {
    for (const [hx, hy] of hole) {
      for (const outer of outers) {
        for (const [ox, oy] of outer) {
          const dx = hx - ox;
          const dy = hy - oy;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
      }
    }
  }
  return Math.sqrt(best);
}

/** Runs the whole pipeline for one exact seed string. Returns null if nothing usable came out. */
function attempt(seed, params) {
  const rng = createRng(seed);
  const field = buildField(rng, params);
  const cells = Math.round(96 + params.complexity * 64);
  const raw = marchingSquares(field.sample, field.threshold, cells);
  const selected = selectLoops(raw, { minArea: 0.002, multiPiece: params.multiPiece });
  if (selected.length === 0) return null;

  // Grid spacing is about 2/cells, so these tolerances work out to a fraction of a cell.
  const tolerance = 0.003 + 0.009 * params.smoothness;
  const passes = params.smoothness < 0.33 ? 1 : 2;
  const smoothed = selected.map((loop) => chaikin(simplifyLoop(loop, tolerance), passes));
  const contours = fitToArtboard(smoothed);

  const outers = contours.filter((l) => signedArea(l) > 0);
  const holes = contours.filter((l) => signedArea(l) < 0);
  const area = contours.reduce((sum, l) => sum + signedArea(l), 0);
  const hullArea = Math.abs(signedArea(convexHull(outers.flat())));
  const fill = area / (ARTBOARD * ARTBOARD);
  const clearance = holeClearance(outers, holes);
  const passed = fill >= 0.08 && fill <= 0.7 && clearance > 8
    && !(params.complexity > 0.3 && hullArea / area < 1.08);
  return { contours, outers, holes, area, fill, hullArea, passed };
}

/**
 * @typedef {object} GeneratedBlob
 * @property {string} seed the seed that was asked for
 * @property {BlobParams} params the normalized params
 * @property {[number, number][][]} contours artboard-space loops, rounded to 2 decimals
 * @property {string} pathData SVG path data, for use with fill-rule="evenodd"
 * @property {{ minX: number, minY: number, maxX: number, maxY: number }} bounds
 * @property {{ area: number, fill: number, holes: number, attempts: number, genVersion: number, passed: boolean }} meta
 */

/**
 * Generates a blob. A rejected attempt retries with seed + "-r1", "-r2" and so on, so
 * the retries are deterministic too. If every attempt fails the checks, the last usable
 * one is returned with meta.passed = false rather than leaving the artist with nothing.
 * @param {{ seed: string, params?: Partial<BlobParams>, genVersion?: number }} input
 * @returns {GeneratedBlob}
 */
export function generateBlob({ seed, params, genVersion = GEN_VERSION }) {
  if (genVersion !== GEN_VERSION) {
    throw new Error(`No generator for version ${genVersion}. Use the path stored with the artwork.`);
  }
  const normalized = normalizeParams(params);
  let chosen = null;
  let attempts = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts = i + 1;
    const result = attempt(i === 0 ? String(seed) : `${seed}-r${i}`, normalized);
    if (result) chosen = result;
    if (result && result.passed) break;
  }
  if (!chosen) throw new Error(`Could not generate a blob for seed "${seed}"`);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of chosen.outers.flat()) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    seed: String(seed),
    params: normalized,
    contours: chosen.contours,
    pathData: loopsToPath(chosen.contours),
    bounds: { minX, minY, maxX, maxY },
    meta: {
      area: chosen.area,
      fill: chosen.fill,
      holes: chosen.holes.length,
      attempts,
      genVersion: GEN_VERSION,
      passed: chosen.passed,
    },
  };
}
