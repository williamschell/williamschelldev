// Browser tests, with no framework. Open tests/index.html through a local server to run them.

import { floodFill } from '../js/fill.js';
import { extractPalette } from '../js/palette.js';

const results = [];

function test(name, body) {
  try {
    body();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}

function equal(actual, expected, label = 'value') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

/** Builds RGBA data from rows of characters, using a color per character. */
function image(rows, colors) {
  const data = new Uint8ClampedArray(rows.length * rows[0].length * 4);
  rows.join('').split('').forEach((ch, i) => data.set(colors[ch], i * 4));
  return { data, width: rows[0].length, height: rows.length };
}

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

/** Which pixels a list of runs covers, as a sorted list of "x,y". */
function covered(runs) {
  const cells = [];
  for (let i = 0; i < runs.length; i += 3) {
    for (let x = 0; x < runs[i + 2]; x++) cells.push(`${runs[i] + x},${runs[i + 1]}`);
  }
  return cells.sort();
}

test('fill: stays inside a closed outline', () => {
  const { data, width, height } = image([
    '.......',
    '.#####.',
    '.#...#.',
    '.#...#.',
    '.#####.',
    '.......',
  ], { '.': WHITE, '#': BLACK });
  const { runs } = floodFill(data, width, height, 3, 3, { fringe: 0 });
  equal(covered(runs), ['2,2', '2,3', '3,2', '3,3', '4,2', '4,3'], 'filled pixels');
});

test('fill: reaches around corners, and each pixel is filled once', () => {
  const { data, width, height } = image([
    '.#...',
    '.#.#.',
    '.#.#.',
    '...#.',
  ], { '.': WHITE, '#': BLACK });
  const { runs } = floodFill(data, width, height, 0, 0, { fringe: 0 });
  const cells = covered(runs);
  equal(cells.length, 14, 'pixel count');
  equal(new Set(cells).size, 14, 'distinct pixels');
});

test('fill: the fringe rings the area and never overlaps it', () => {
  const { data, width, height } = image([
    '#####',
    '#...#',
    '#####',
  ], { '.': WHITE, '#': BLACK });
  const { runs, fringe } = floodFill(data, width, height, 2, 1, { fringe: 1 });
  equal(covered(runs), ['1,1', '2,1', '3,1'], 'filled pixels');
  const ring = covered(fringe);
  equal(ring.length, 12, 'fringe size');
  equal(ring.filter((cell) => covered(runs).includes(cell)), [], 'overlap');
});

test('fill: tolerance swallows soft edges but stops at real ones', () => {
  const { data, width, height } = image(['.~#'], { '.': WHITE, '~': [230, 230, 230, 255], '#': BLACK });
  equal(covered(floodFill(data, width, height, 0, 0, { tolerance: 40, fringe: 0 }).runs), ['0,0', '1,0'], 'loose');
  equal(covered(floodFill(data, width, height, 0, 0, { tolerance: 5, fringe: 0 }).runs), ['0,0'], 'strict');
});

test('fill: a click outside the image does nothing', () => {
  const { data, width, height } = image(['..'], { '.': WHITE });
  equal(floodFill(data, width, height, 9, 9), { runs: [], fringe: [] });
});

const CLEAR = [0, 0, 0, 0];
const RED = [229, 53, 43, 255];
const BLUE = [42, 109, 255, 255];

test('palette: most used color first, and transparent pixels ignored', () => {
  const { data } = image(['BBBBRR..'], { B: BLUE, R: RED, '.': CLEAR });
  equal(extractPalette(data, { step: 1 }), ['#2a6dff', '#e5352b']);
});

test('palette: exact drawn colors win over near-identical edge pixels', () => {
  const { data } = image(['RRRRRrrB'], { R: RED, r: [231, 55, 40, 255], B: BLUE });
  equal(extractPalette(data, { step: 1 }), ['#e5352b', '#2a6dff']);
});

test('palette: colors that look the same become one swatch', () => {
  const { data } = image(['RRRRRSSS'], { R: RED, S: [215, 60, 50, 255] });
  equal(extractPalette(data, { step: 1 }), ['#e5352b']);
});

test('palette: rare blends are left out, and max is respected', () => {
  const row = `${'R'.repeat(600)}${'B'.repeat(600)}x`;
  const { data } = image([row], { R: RED, B: BLUE, x: [120, 80, 150, 255] });
  equal(extractPalette(data, { step: 1 }).length, 2, 'without the blend');
  equal(extractPalette(data, { step: 1, max: 1 }).length, 1, 'with max 1');
});

test('palette: an empty canvas has no colors', () => {
  const { data } = image(['....'], { '.': CLEAR });
  equal(extractPalette(data, { step: 1 }), []);
});

const failed = results.filter((r) => !r.ok);
const host = document.getElementById('results');
host.textContent = `${results.length - failed.length} of ${results.length} passed\n\n${results
  .map((r) => `${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.message ? `\n     ${r.message}` : ''}`)
  .join('\n')}`;
document.title = failed.length ? `FAILED ${failed.length}` : 'PASSED';
