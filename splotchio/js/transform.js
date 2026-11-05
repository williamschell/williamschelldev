// Non-destructive blob transforms as a single 2D affine matrix.
// Matrices are [a, b, c, d, e, f], which maps (x, y) to (ax + cy + e, bx + dy + f),
// the same layout as SVG matrix() and canvas transform().

/**
 * @typedef {object} BlobTransform
 * @property {number} rotate degrees
 * @property {boolean} flipX
 * @property {boolean} flipY
 * @property {number} scaleX stretch
 * @property {number} scaleY stretch
 * @property {number} scale uniform scale
 */

/** @returns {BlobTransform} */
export function defaultTransform() {
  return { rotate: 0, flipX: false, flipY: false, scaleX: 1, scaleY: 1, scale: 1 };
}

/**
 * Multiplies two matrices. The result applies m2 first, then m1.
 * @param {number[]} m1
 * @param {number[]} m2
 * @returns {number[]}
 */
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * Composes the transform around the artboard center: stretch and flip first, then
 * rotate, then move back into place.
 * @param {BlobTransform} t
 * @param {number} size artboard size
 * @returns {number[]}
 */
export function composeMatrix(t, size) {
  const c = size / 2;
  const rad = (t.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = t.scale * t.scaleX * (t.flipX ? -1 : 1);
  const sy = t.scale * t.scaleY * (t.flipY ? -1 : 1);
  let m = [1, 0, 0, 1, c, c];
  m = multiply(m, [cos, sin, -sin, cos, 0, 0]);
  m = multiply(m, [sx, 0, 0, sy, 0, 0]);
  m = multiply(m, [1, 0, 0, 1, -c, -c]);
  return m;
}

/**
 * Inverts an affine matrix.
 * @param {number[]} m
 * @returns {number[]}
 */
export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

/**
 * Applies a matrix to a point.
 * @param {number[]} m
 * @param {[number, number]} point
 * @returns {[number, number]}
 */
export function applyMatrix(m, [x, y]) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * @param {number[]} m
 * @returns {string} value for an SVG transform attribute
 */
export function toSvgMatrix(m) {
  return `matrix(${m.map((n) => Math.round(n * 1e5) / 1e5).join(' ')})`;
}

/**
 * Fills in anything missing from a stored transform.
 * @param {Partial<BlobTransform>} [t]
 * @returns {BlobTransform}
 */
export function normalizeTransform(t = {}) {
  return { ...defaultTransform(), ...t };
}
