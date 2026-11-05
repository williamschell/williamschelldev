// Brush textures. Everything here has to come out the same on every replay, because undo
// redraws strokes from their records. So randomness comes from the seeded rng, never Math.random.

import { createRng } from './rng.js';

/** Brush ids and their names in the UI. Pen is the original solid ink. */
export const BRUSHES = [['pen', 'Pen'], ['pencil', 'Pencil'], ['marker', 'Marker'], ['paint', 'Paintbrush']];

/** How see-through a marker stroke is. One stroke is even, and crossing strokes darken. */
export const MARKER_ALPHA = 0.55;

const hexToRgb = (hex) => {
  const value = parseInt(hex.slice(1), 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

// The share of the paper's "tooth" that pencil graphite skips. It's well below the 59% at
// which gaps would join up across a line, so the fill tool can't leak through a pencil line.
const TOOTH_GAPS = 0.3;
const GRAIN_TILE = 256;

const grainCache = new Map();

/**
 * A repeating pattern of the color with grainy gaps. The grain is fixed to the paper, not to
 * the stroke, so going over a line darkens it but never quite fills the gaps, as with a real
 * pencil. Using a pattern also means taper and pressure work with no extra code. Tile pixels
 * are half an artboard unit, so the grain looks the same at any screen density.
 * @param {string} color
 * @returns {CanvasPattern}
 */
function pencilPattern(color) {
  if (grainCache.has(color)) return grainCache.get(color);
  if (grainCache.size >= 64) grainCache.clear();
  const tile = document.createElement('canvas');
  tile.width = GRAIN_TILE;
  tile.height = GRAIN_TILE;
  const ctx = tile.getContext('2d');
  const image = ctx.createImageData(GRAIN_TILE, GRAIN_TILE);
  const [r, g, b] = hexToRgb(color);
  const rng = createRng('pencil-grain');
  for (let y = 0; y < GRAIN_TILE; y += 2) {
    for (let x = 0; x < GRAIN_TILE; x += 2) {
      const alpha = rng.chance(TOOTH_GAPS) ? 0 : Math.round(rng.range(120, 255));
      // Grains are 2x2 tile pixels, a full artboard unit across.
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const o = ((y + dy) * GRAIN_TILE + x + dx) * 4;
        image.data[o] = r;
        image.data[o + 1] = g;
        image.data[o + 2] = b;
        image.data[o + 3] = alpha;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  const pattern = ctx.createPattern(tile, 'repeat');
  pattern.setTransform(new DOMMatrix().scale(0.5));
  grainCache.set(color, pattern);
  return pattern;
}

/**
 * @param {{ b?: string, c: string }} stroke
 * @returns {string|CanvasPattern} what to set as the stroke and fill style
 */
export function strokePaint(stroke) {
  return stroke.b === 'pencil' ? pencilPattern(stroke.c) : stroke.c;
}

const hairCache = new WeakMap();

/** Moves a color toward white (amount above 0) or black (amount below 0). */
function shade([r, g, b], amount) {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  const mix = (v) => Math.round(v + (target - v) * t);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

/**
 * The bristles of a paintbrush stroke. Each one keeps a fixed spot in the brush head for the
 * whole stroke, so its slightly different shade shows as a streak along the line. Spots are
 * spread evenly over a disc (radius = sqrt(u)), and offsets and widths are fractions of the
 * brush width so they can follow pen pressure. The seed comes from the stroke itself, so
 * replays match but no two strokes share a pattern.
 * @param {{ s: number, c: string, p: number[] }} stroke
 * @returns {{ x: number, y: number, w: number, color: string }[]}
 */
export function hairsFor(stroke) {
  let hairs = hairCache.get(stroke);
  if (hairs) return hairs;
  const rng = createRng(`${stroke.p[0]},${stroke.p[1]},${stroke.s},${stroke.c}`);
  const rgb = hexToRgb(stroke.c);
  const count = Math.max(8, Math.min(44, Math.round(stroke.s * 1.1)));
  hairs = [];
  for (let i = 0; i < count; i++) {
    const w = rng.range(0.08, 0.2);
    const radius = Math.sqrt(rng.next()) * (0.5 - w / 2);
    const angle = rng.range(0, Math.PI * 2);
    hairs.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      w,
      color: shade(rgb, rng.range(-0.14, 0.14)),
    });
  }
  hairCache.set(stroke, hairs);
  return hairs;
}
