// Flood fill for the fill tool. Pure: it works on raw RGBA data and never touches the DOM.

/**
 * Scanline flood fill. From each seed it extends left and right to a maximal horizontal
 * span, then looks for matching spans in the rows above and below. Every span is visited
 * once, so this is far quicker than checking a whole 2048 px canvas pixel by pixel.
 *
 * Drawn lines have soft antialiased edges, and a fill that stops at the first pixel that
 * differs leaves a pale halo around every line. So this also returns a "fringe": the pixels
 * just outside the filled area. Painted underneath existing art, the fringe closes that gap
 * without covering the line.
 *
 * @param {Uint8ClampedArray} pixels RGBA data
 * @param {number} width
 * @param {number} height
 * @param {number} startX
 * @param {number} startY
 * @param {{ tolerance?: number, fringe?: number }} [options] tolerance is the largest allowed
 *   difference in any one channel, and fringe is how many pixels the fringe reaches
 * @returns {{ runs: number[], fringe: number[] }} flat lists of x, y, length
 */
export function floodFill(pixels, width, height, startX, startY, { tolerance = 40, fringe = 1 } = {}) {
  const runs = [];
  const fringeRuns = [];
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return { runs, fringe: fringeRuns };

  const seed = (startY * width + startX) * 4;
  const r = pixels[seed];
  const g = pixels[seed + 1];
  const b = pixels[seed + 2];
  const a = pixels[seed + 3];
  const filled = new Uint8Array(width * height);
  const matches = (i) => {
    const o = i * 4;
    return Math.abs(pixels[o] - r) <= tolerance
      && Math.abs(pixels[o + 1] - g) <= tolerance
      && Math.abs(pixels[o + 2] - b) <= tolerance
      && Math.abs(pixels[o + 3] - a) <= tolerance;
  };

  const stack = [startX, startY];
  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    const row = y * width;
    if (filled[row + x]) continue;
    let left = x;
    while (left > 0 && matches(row + left - 1)) left--;
    let right = x;
    while (right < width - 1 && matches(row + right + 1)) right++;
    filled.fill(1, row + left, row + right + 1);
    runs.push(left, y, right - left + 1);
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue;
      const nextRow = ny * width;
      let inSpan = false;
      for (let nx = left; nx <= right; nx++) {
        const open = !filled[nextRow + nx] && matches(nextRow + nx);
        // One seed per span is enough, since popping it extends across the whole span.
        if (open && !inSpan) stack.push(nx, ny);
        inSpan = open;
      }
    }
  }

  // Grow each run by the fringe distance. Whatever grew but wasn't filled is the fringe.
  const grown = new Uint8Array(width * height);
  for (let i = 0; i < runs.length; i += 3) {
    const from = Math.max(0, runs[i] - fringe);
    const to = Math.min(width, runs[i] + runs[i + 2] + fringe);
    const top = Math.max(0, runs[i + 1] - fringe);
    const bottom = Math.min(height - 1, runs[i + 1] + fringe);
    for (let y = top; y <= bottom; y++) grown.fill(1, y * width + from, y * width + to);
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const edge = x < width && grown[row + x] && !filled[row + x];
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        fringeRuns.push(start, y, x - start);
        start = -1;
      }
    }
  }
  return { runs, fringe: fringeRuns };
}
