// Marching squares: scalar grid -> closed polylines -> cleaned-up loops.

/** @typedef {[number, number][]} Loop */

// Corner bits of a cell, with y pointing down:
//   a(1) --T-- b(2)
//    |          |
//    L          R
//    |          |
//   d(8) --B-- c(4)
const T = 0;
const R = 1;
const B = 2;
const L = 3;

// Each entry is the directed segments for a case, as [fromEdge, toEdge]. Segments
// always run with the inside on their right, as seen on screen. That one rule means
// outer loops come out clockwise and holes counterclockwise, with no second pass.
// Cases 5 and 10 are the ambiguous saddles and are resolved in the loop below.
const CASES = [
  [], // 0: all outside
  [[T, L]], // 1: a
  [[R, T]], // 2: b
  [[R, L]], // 3: a b
  [[B, R]], // 4: c
  null, // 5: a c (saddle)
  [[B, T]], // 6: b c
  [[B, L]], // 7: a b c
  [[L, B]], // 8: d
  [[T, B]], // 9: a d
  null, // 10: b d (saddle)
  [[R, B]], // 11: a b d
  [[L, R]], // 12: c d
  [[T, R]], // 13: a c d
  [[L, T]], // 14: b c d
  [], // 15: all inside
];

// Saddles depend on whether the cell's center is inside, which we estimate with the
// average of its corners. If it's inside, the two inside corners are joined across
// the center, otherwise they're separate.
const SADDLE_5_JOINED = [[T, R], [B, L]];
const SADDLE_5_SPLIT = [[T, L], [B, R]];
const SADDLE_10_JOINED = [[L, T], [R, B]];
const SADDLE_10_SPLIT = [[R, T], [L, B]];

/**
 * Extracts every closed contour of the field at a threshold. The outermost ring of
 * samples is forced to zero, so no loop can run off the grid and stay open.
 * @param {(x: number, y: number) => number} sample
 * @param {number} threshold
 * @param {number} cells grid cells per side
 * @returns {Loop[]} loops in [-1, 1]²
 */
export function marchingSquares(sample, threshold, cells) {
  const side = cells + 1;
  const grid = new Float64Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const onEdge = i === 0 || j === 0 || i === cells || j === cells;
      grid[j * side + i] = onEdge ? 0 : sample((i / cells) * 2 - 1, (j / cells) * 2 - 1);
    }
  }

  // Each grid edge gets one key: 2 * index for the horizontal edge going right from a
  // corner and 2 * index + 1 for the vertical edge going down. Neighbouring cells then
  // agree on where a crossing is, which is what stitches the segments together.
  const edgeKey = (i, j, edge) => {
    switch (edge) {
      case T: return 2 * (j * side + i);
      case B: return 2 * ((j + 1) * side + i);
      case L: return 2 * (j * side + i) + 1;
      default: return 2 * (j * side + i + 1) + 1;
    }
  };

  const crossing = (i, j, edge) => {
    // Linear interpolation: the point on the edge where the field equals the threshold.
    const lerpT = (va, vb) => (threshold - va) / (vb - va);
    const at = (x, y) => grid[y * side + x];
    let gx;
    let gy;
    if (edge === T) {
      gx = i + lerpT(at(i, j), at(i + 1, j));
      gy = j;
    } else if (edge === B) {
      gx = i + lerpT(at(i, j + 1), at(i + 1, j + 1));
      gy = j + 1;
    } else if (edge === L) {
      gx = i;
      gy = j + lerpT(at(i, j), at(i, j + 1));
    } else {
      gx = i + 1;
      gy = j + lerpT(at(i + 1, j), at(i + 1, j + 1));
    }
    return [(gx / cells) * 2 - 1, (gy / cells) * 2 - 1];
  };

  /** start edge key -> { to: end edge key, point: start point } */
  const links = new Map();
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = grid[j * side + i];
      const b = grid[j * side + i + 1];
      const c = grid[(j + 1) * side + i + 1];
      const d = grid[(j + 1) * side + i];
      const code = (a >= threshold ? 1 : 0) | (b >= threshold ? 2 : 0)
        | (c >= threshold ? 4 : 0) | (d >= threshold ? 8 : 0);
      let segments = CASES[code];
      if (segments === null) {
        const centerInside = (a + b + c + d) / 4 >= threshold;
        if (code === 5) segments = centerInside ? SADDLE_5_JOINED : SADDLE_5_SPLIT;
        else segments = centerInside ? SADDLE_10_JOINED : SADDLE_10_SPLIT;
      }
      for (const [from, to] of segments) {
        links.set(edgeKey(i, j, from), { to: edgeKey(i, j, to), point: crossing(i, j, from) });
      }
    }
  }

  // Follow the links. Every crossing has exactly one way out, so each walk returns
  // to where it started and gives a closed loop.
  const loops = [];
  for (const start of [...links.keys()]) {
    if (!links.has(start)) continue;
    const loop = [];
    let key = start;
    while (links.has(key)) {
      const link = links.get(key);
      links.delete(key);
      loop.push(link.point);
      key = link.to;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Shoelace formula. With y pointing down, a positive result means clockwise on screen.
 * @param {Loop} loop
 * @returns {number}
 */
export function signedArea(loop) {
  let sum = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    sum += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  }
  return sum / 2;
}

/**
 * Even-odd ray test.
 * @param {[number, number]} point
 * @param {Loop} loop
 * @returns {boolean}
 */
export function pointInLoop([x, y], loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ramer-Douglas-Peucker on an open polyline: keep the farthest point if it's past tolerance, then recurse. */
function rdpOpen(points, tolerance) {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length > 0) {
    const [lo, hi] = stack.pop();
    const [ax, ay] = points[lo];
    const [bx, by] = points[hi];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let best = -1;
    let bestD2 = t2;
    for (let i = lo + 1; i < hi; i++) {
      // Squared perpendicular distance from point i to the chord.
      const cross = (points[i][0] - ax) * dy - (points[i][1] - ay) * dx;
      const d2 = (cross * cross) / len2;
      if (d2 > bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best !== -1) {
      keep[best] = 1;
      stack.push([lo, best], [best, hi]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Simplifies a closed loop. RDP needs two endpoints, so the loop is split at two
 * far-apart points and each half is simplified separately.
 * @param {Loop} loop
 * @param {number} tolerance
 * @returns {Loop}
 */
export function simplifyLoop(loop, tolerance) {
  if (loop.length < 8) return loop;
  const [x0, y0] = loop[0];
  let far = 0;
  let farD2 = -1;
  for (let i = 1; i < loop.length; i++) {
    const dx = loop[i][0] - x0;
    const dy = loop[i][1] - y0;
    const d2 = dx * dx + dy * dy;
    if (d2 > farD2) {
      farD2 = d2;
      far = i;
    }
  }
  const first = rdpOpen(loop.slice(0, far + 1), tolerance);
  const second = rdpOpen([...loop.slice(far), loop[0]], tolerance);
  return [...first, ...second.slice(1, -1)];
}

/**
 * Chaikin corner cutting: each edge is replaced by points 1/4 and 3/4 along it. The
 * limit curve of repeated passes is a quadratic B-spline.
 * @param {Loop} loop
 * @param {number} passes
 * @returns {Loop}
 */
export function chaikin(loop, passes) {
  let current = loop;
  for (let p = 0; p < passes; p++) {
    const next = [];
    for (let i = 0; i < current.length; i++) {
      const [ax, ay] = current[i];
      const [bx, by] = current[(i + 1) % current.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    current = next;
  }
  return current;
}

/**
 * Keeps the largest outer loop and the holes inside it, dropping specks. With
 * multiPiece, other outer islands above minArea are kept too.
 * @param {Loop[]} loops
 * @param {{ minArea: number, multiPiece?: boolean }} options
 * @returns {Loop[]} outer loops, each followed by its holes
 */
export function selectLoops(loops, { minArea, multiPiece = false }) {
  const outers = [];
  const holes = [];
  for (const loop of loops) {
    const area = signedArea(loop);
    if (Math.abs(area) < minArea) continue;
    (area > 0 ? outers : holes).push({ loop, area });
  }
  outers.sort((a, b) => b.area - a.area);
  const kept = multiPiece ? outers : outers.slice(0, 1);
  const out = [];
  for (const { loop } of kept) {
    out.push(loop);
    for (const hole of holes) {
      if (pointInLoop(hole.loop[0], loop)) out.push(hole.loop);
    }
  }
  return out;
}
