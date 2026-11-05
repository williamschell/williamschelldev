// Share links: ?seed=...&p=... rebuilds the exact same blob.

import { normalizeParams } from './blob.js';

// Fixed order. Complexity and smoothness keep 3 decimals so daily params survive
// exactly, and aspect does too.
const FIELDS = [
  ['complexity', 1000],
  ['lobes', 1],
  ['holes', 1],
  ['protrusions', 1],
  ['aspect', 1000],
  ['smoothness', 1000],
];

/**
 * @param {import('./blob.js').BlobParams} params
 * @returns {string} e.g. "500_3_1_3_1000_600"
 */
export function encodeParams(params) {
  const p = normalizeParams(params);
  return FIELDS.map(([key, mult]) => Math.round(p[key] * mult)).join('_');
}

/**
 * @param {string} text
 * @returns {import('./blob.js').BlobParams|null} null if the text is malformed
 */
export function decodeParams(text) {
  const parts = String(text).split('_');
  if (parts.length !== FIELDS.length || parts.some((v) => !/^\d+$/.test(v))) return null;
  const params = {};
  FIELDS.forEach(([key, mult], i) => {
    params[key] = Number(parts[i]) / mult;
  });
  return normalizeParams(params);
}

/**
 * @param {string} seed
 * @param {import('./blob.js').BlobParams} params
 * @returns {string} query string with a leading "?"
 */
export function encodeShareQuery(seed, params) {
  const query = new URLSearchParams({ seed, p: encodeParams(params) });
  return `?${query.toString()}`;
}

/**
 * @param {string} search location.search
 * @returns {{ seed: string, params: import('./blob.js').BlobParams }|null}
 */
export function decodeShareQuery(search) {
  const query = new URLSearchParams(search);
  const seed = query.get('seed');
  if (!seed || seed.length > 80) return null;
  const params = decodeParams(query.get('p') ?? '');
  return params ? { seed, params } : null;
}
