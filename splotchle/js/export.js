// Flattening art to images: PNG and SVG downloads, thumbnails and gallery uploads.

import { ARTBOARD } from './blob.js';
import { composeMatrix, toSvgMatrix } from './transform.js';

/** The paper color. Matches --paper in the stylesheet. */
export const PAPER = '#ffffff';

/**
 * @typedef {object} BlobStyle
 * @property {'fill'|'outline'|'ghost'} mode
 * @property {string} color
 * @property {boolean} visible
 */

/** How thick the outline style is, in artboard units. */
export const OUTLINE_WIDTH = 6;

/** Opacity of the ghost style. */
export const GHOST_OPACITY = 0.22;

/**
 * Paints the blob into a context that is already scaled to artboard units.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ pathData: string, transform: import('./transform.js').BlobTransform, blobStyle: BlobStyle }} art
 */
export function paintBlob(ctx, { pathData, transform, blobStyle }) {
  const m = composeMatrix(transform, ARTBOARD);
  const path = new Path2D(pathData);
  ctx.save();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  if (blobStyle.mode === 'outline') {
    ctx.strokeStyle = blobStyle.color;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  } else {
    ctx.globalAlpha = blobStyle.mode === 'ghost' ? GHOST_OPACITY : 1;
    ctx.fillStyle = blobStyle.color;
    ctx.fill(path, 'evenodd');
  }
  ctx.restore();
}

/**
 * Makes one square panel: paper, optionally the blob, optionally the drawing.
 * @param {object} art
 * @param {string} art.pathData
 * @param {import('./transform.js').BlobTransform} art.transform
 * @param {BlobStyle} art.blobStyle
 * @param {CanvasImageSource|null} [art.drawing]
 * @param {number} size output pixels per side
 * @param {{ blob?: boolean }} [options]
 * @returns {HTMLCanvasElement}
 */
export function renderPanel(art, size, { blob = art.blobStyle.visible } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  if (blob) {
    ctx.save();
    ctx.scale(size / ARTBOARD, size / ARTBOARD);
    paintBlob(ctx, art);
    ctx.restore();
  }
  if (art.drawing) ctx.drawImage(art.drawing, 0, 0, size, size);
  return canvas;
}

/**
 * Just the drawing, on a transparent background, for gallery uploads. Viewers can then see it
 * layered over the blob or on its own.
 * @param {CanvasImageSource} drawing
 * @param {number} size output pixels per side
 * @returns {HTMLCanvasElement}
 */
export function renderDrawing(drawing, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawing, 0, 0, size, size);
  return canvas;
}

/**
 * The side-by-side image: the blob on the left and the artwork on the right.
 * @param {object} art same shape as renderPanel
 * @param {number} size pixels per panel side
 * @returns {HTMLCanvasElement}
 */
export function renderSideBySide(art, size) {
  const gutter = Math.round(size / 32);
  const canvas = document.createElement('canvas');
  canvas.width = size * 2 + gutter * 3;
  canvas.height = size + gutter * 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a2463';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const shown = { ...art, blobStyle: { ...art.blobStyle, visible: true } };
  ctx.drawImage(renderPanel({ ...shown, drawing: null }, size), gutter, gutter);
  ctx.drawImage(renderPanel(art, size), size + gutter * 2, gutter);
  return canvas;
}

/**
 * Builds a standalone SVG of the blob alone, with the transform applied.
 * @param {{ pathData: string, transform: import('./transform.js').BlobTransform, blobStyle: BlobStyle }} art
 * @returns {string}
 */
export function buildBlobSvg({ pathData, transform, blobStyle }) {
  const matrix = toSvgMatrix(composeMatrix(transform, ARTBOARD));
  let paint = `fill="${blobStyle.color}"`;
  if (blobStyle.mode === 'outline') {
    paint = `fill="none" stroke="${blobStyle.color}" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round"`;
  } else if (blobStyle.mode === 'ghost') {
    paint = `fill="${blobStyle.color}" fill-opacity="${GHOST_OPACITY}"`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ARTBOARD} ${ARTBOARD}" width="${ARTBOARD}" height="${ARTBOARD}">`
    + `<g transform="${matrix}"><path fill-rule="evenodd" ${paint} d="${pathData}"/></g></svg>\n`;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} [type]
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, type = 'image/png', quality = undefined) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), type, quality);
  });
}

/**
 * Starts a browser download.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Exports art as a file download.
 * @param {'png'|'side'|'svg'} kind
 * @param {{ pathData: string, transform: object, blobStyle: BlobStyle, drawing: HTMLCanvasElement|ImageBitmap|null }} art
 * @param {string} name file name without its extension
 */
export async function downloadArt(kind, art, name) {
  const base = slug(name);
  if (kind === 'svg') {
    downloadBlob(new Blob([buildBlobSvg(art)], { type: 'image/svg+xml' }), `${base}-blob.svg`);
    return;
  }
  const size = art.drawing?.width || ARTBOARD;
  const canvas = kind === 'side' ? renderSideBySide(art, size) : renderPanel(art, size);
  downloadBlob(await canvasToBlob(canvas), `${base}${kind === 'side' ? '-side-by-side' : ''}.png`);
}

/** Makes a string safe to use in a file name. */
export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'splotch';
}

/**
 * Encodes a canvas under a byte limit, lowering quality and then size until it fits.
 * Safari can't encode WebP and quietly returns PNG, so check the type of what comes back.
 * @param {HTMLCanvasElement} source
 * @param {number} maxBytes
 * @returns {Promise<Blob>}
 */
export async function encodeUnderLimit(source, maxBytes) {
  let canvas = source;
  for (let round = 0; round < 4; round++) {
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await canvasToBlob(canvas, 'image/webp', quality);
      if (blob.size <= maxBytes) return blob;
      if (blob.type !== 'image/webp') break;
    }
    const next = document.createElement('canvas');
    next.width = Math.round(canvas.width * 0.75);
    next.height = next.width;
    next.getContext('2d').drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }
  throw new Error('That drawing is too detailed to upload.');
}
