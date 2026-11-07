// Color conversions. Pure. Picker colors are sRGB throughout.

/**
 * @param {number} h hue in degrees
 * @param {number} s 0..1
 * @param {number} v 0..1
 * @returns {string} '#rrggbb'
 */
export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @param {string} hex '#rrggbb'
 * @returns {{ h: number, s: number, v: number }} h in degrees, s and v 0..1
 */
export function hexToHsv(hex) {
  const value = parseInt(hex.slice(1), 16) || 0;
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Accepts the ways people type a hex color.
 * @param {string} text
 * @returns {string|null} '#rrggbb', or null if it isn't one
 */
export function parseHex(text) {
  const trimmed = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(trimmed)) return `#${trimmed}`;
  if (/^[0-9a-f]{3}$/.test(trimmed)) return `#${[...trimmed].map((c) => c + c).join('')}`;
  return null;
}
