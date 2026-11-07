// UV layout analysis. Pure: plain arrays in, plain answers out.

const GRID = 512;

/**
 * Decides whether a UV layout can be painted on as it is. Painting needs each surface point to own
 * its texels, so what matters is overlap and anything outside the 0..1 square.
 *
 * Overlap is measured as total triangle area over the area actually covered, on a coarse grid. A
 * clean layout scores close to 1, and a model that reuses the same texels twice scores about 2.
 *
 * @param {ArrayLike<number>} index
 * @param {ArrayLike<number>} uv flat u, v pairs
 * @returns {{ overlap: number, outside: number, empty: boolean, usable: boolean }}
 */
export function analyzeUvs(index, uv) {
  const covered = new Uint8Array(GRID * GRID);
  let total = 0;
  let outsideArea = 0;
  for (let t = 0; t < index.length; t += 3) {
    const ax = uv[index[t] * 2];
    const ay = uv[index[t] * 2 + 1];
    const bx = uv[index[t + 1] * 2];
    const by = uv[index[t + 1] * 2 + 1];
    const cx = uv[index[t + 2] * 2];
    const cy = uv[index[t + 2] * 2 + 1];
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    total += area;
    const outside = Math.min(ax, bx, cx) < -0.001 || Math.max(ax, bx, cx) > 1.001
      || Math.min(ay, by, cy) < -0.001 || Math.max(ay, by, cy) > 1.001;
    if (outside) outsideArea += area;
    rasterize(covered, ax, ay, bx, by, cx, cy);
  }
  let cells = 0;
  for (let i = 0; i < covered.length; i++) cells += covered[i];
  const union = cells / (GRID * GRID);
  const empty = total < 1e-6;
  const overlap = empty || union === 0 ? 1 : total / union;
  const outside = empty ? 0 : outsideArea / total;
  return {
    overlap, outside, empty, usable: !empty && overlap < 1.25 && outside < 0.01,
  };
}

/** Marks the grid cells a triangle covers. Tiny triangles still mark the cell they sit in. */
function rasterize(covered, ax, ay, bx, by, cx, cy) {
  const scale = GRID;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) * scale));
  const x1 = Math.min(GRID - 1, Math.ceil(Math.max(ax, bx, cx) * scale));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) * scale));
  const y1 = Math.min(GRID - 1, Math.ceil(Math.max(ay, by, cy) * scale));
  const mx = Math.floor(((ax + bx + cx) / 3) * scale);
  const my = Math.floor(((ay + by + cy) / 3) * scale);
  if (mx >= 0 && my >= 0 && mx < GRID && my < GRID) covered[my * GRID + mx] = 1;

  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denom) < 1e-12) return;
  for (let y = y0; y <= y1; y++) {
    const py = (y + 0.5) / scale;
    for (let x = x0; x <= x1; x++) {
      const px = (x + 0.5) / scale;
      // Barycentric coordinates tell whether this cell's center is inside the triangle.
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
      const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
      if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) covered[y * GRID + x] = 1;
    }
  }
}

/**
 * Splits triangles into UV islands: groups joined through shared corners in UV space. Corners are
 * compared by their UV value rather than their vertex number, so meshes that repeat vertices along
 * hard edges still join up, and islands stacked exactly on the same texels count as one.
 *
 * @param {ArrayLike<number>} index
 * @param {ArrayLike<number>} uv flat u, v pairs
 * @returns {{ triangleIsland: Int32Array, count: number }}
 */
export function computeIslands(index, uv) {
  const triangleCount = Math.floor(index.length / 3);
  const parent = new Int32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) parent[i] = i;
  const find = (x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };

  // The first triangle seen at each UV corner stands in for all of them.
  const corners = new Map();
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k];
      const key = `${Math.round(uv[v * 2] * 1e5)},${Math.round(uv[v * 2 + 1] * 1e5)}`;
      const other = corners.get(key);
      if (other === undefined) corners.set(key, t);
      else parent[find(t)] = find(other);
    }
  }

  const ids = new Map();
  const triangleIsland = new Int32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    const root = find(t);
    if (!ids.has(root)) ids.set(root, ids.size);
    triangleIsland[t] = ids.get(root);
  }
  return { triangleIsland, count: ids.size };
}

/**
 * Lists a layout's edges for the UV view's wireframe. Each edge appears once.
 * @param {ArrayLike<number>} index
 * @param {ArrayLike<number>} uv
 * @returns {Float32Array} flat u, v, u, v
 */
export function uvEdges(index, uv) {
  const seen = new Set();
  const out = [];
  const add = (a, b) => {
    const ka = `${Math.round(uv[a * 2] * 1e5)},${Math.round(uv[a * 2 + 1] * 1e5)}`;
    const kb = `${Math.round(uv[b * 2] * 1e5)},${Math.round(uv[b * 2 + 1] * 1e5)}`;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(uv[a * 2], uv[a * 2 + 1], uv[b * 2], uv[b * 2 + 1]);
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    add(index[t], index[t + 1]);
    add(index[t + 1], index[t + 2]);
    add(index[t + 2], index[t]);
  }
  return new Float32Array(out);
}
