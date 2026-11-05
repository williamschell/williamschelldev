// Polylines -> SVG path data.

const round2 = (n) => {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r; // Math.round can produce -0, which would print differently.
};

/**
 * Converts closed loops into cubic Bézier path data. Each loop is treated as a closed
 * uniform Catmull-Rom spline, which passes through every point. A Catmull-Rom segment
 * from P1 to P2 with neighbours P0 and P3 is exactly this cubic Bézier:
 *   C1 = P1 + (P2 - P0) / 6
 *   C2 = P2 - (P3 - P1) / 6
 * @param {[number, number][][]} loops
 * @returns {string}
 */
export function loopsToPath(loops) {
  const parts = [];
  for (const loop of loops) {
    const n = loop.length;
    parts.push(`M${round2(loop[0][0])} ${round2(loop[0][1])}`);
    for (let i = 0; i < n; i++) {
      const p0 = loop[(i - 1 + n) % n];
      const p1 = loop[i];
      const p2 = loop[(i + 1) % n];
      const p3 = loop[(i + 2) % n];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      parts.push(`C${round2(c1x)} ${round2(c1y)} ${round2(c2x)} ${round2(c2y)} ${round2(p2[0])} ${round2(p2[1])}`);
    }
    parts.push('Z');
  }
  return parts.join('');
}
