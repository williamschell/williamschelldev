// Unit tests for the pure modules. Open tests/index.html over HTTP. There's no framework: each test is
// a function that throws on failure. tests/e2e.mjs covers everything that needs the GPU.

import {
  History, TILE, sliceTile, tileBounds,
} from '../js/paint/history.js';
import { applyPressureCurve } from '../js/paint/brush.js';
import { analyzeUvs, computeIslands, uvEdges } from '../js/mesh/uvs.js';
import { chunkMesh } from '../js/mesh/unwrap.js';
import { TOON_EXTENSION, readGlbJson, writeGlb } from '../js/io/glb.js';
import { kmeansPalette } from '../js/paint/kmeans.js';
import { applyFlood, blendTexel, clippedFlood } from '../js/paint/fills.js';
import { hexToHsv, hsvToHex, parseHex } from '../js/ui/color.js';
import {
  actionFor, bindingFor, bindingOf, prettyBinding,
} from '../js/core/settings.js';
import { dilationRadius } from '../js/paint/passes.js';
import { TOON_CANONICAL } from '../js/shaders/toon.glsl.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (actual, expected, label = '') => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} expected ${b}, got ${a}`);
};
const ok = (value, label = 'expected true') => {
  if (!value) throw new Error(label);
};
const near = (a, b, tolerance, label = '') => {
  if (Math.abs(a - b) > tolerance) throw new Error(`${label} expected about ${b}, got ${a}`);
};

// The toon shader and its docs ----------------------------------------------------------------------

test('docs/toon-shader.md carries the exact canonical shader math', async () => {
  const response = await fetch('../docs/toon-shader.md');
  const docs = (await response.text()).replace(/\r\n/g, '\n');
  ok(docs.includes(TOON_CANONICAL.trim()), 'docs/toon-shader.md and js/shaders/toon.glsl.js have drifted apart');
});

// Undo history ---------------------------------------------------------------------------------------

const entry = (bytes, log = [], label = 'x') => ({ bytes, label, swap: () => log.push(label) });

test('history: undo and redo walk the stacks', async () => {
  const history = new History(1000);
  const log = [];
  history.push(entry(10, log, 'a'));
  history.push(entry(10, log, 'b'));
  await history.undo();
  eq(log, ['b']);
  ok(history.canRedo);
  await history.redo();
  eq(log, ['b', 'b']);
  await history.undo();
  await history.undo();
  eq(log, ['b', 'b', 'b', 'a']);
  ok(!history.canUndo);
});

test('history: a new edit clears redo and frees its memory', async () => {
  const history = new History(1000);
  history.push(entry(100));
  await history.undo();
  eq(history.bytes, 100);
  history.push(entry(30));
  ok(!history.canRedo);
  eq(history.bytes, 30);
});

test('history: over budget, the oldest steps drop first', () => {
  const history = new History(100);
  history.push(entry(40, [], 'old'));
  history.push(entry(40, [], 'mid'));
  history.push(entry(40, [], 'new'));
  eq(history.undoStack.map((e) => e.label), ['mid', 'new']);
  eq(history.bytes, 80);
});

test('history: the newest step survives even if it is over budget alone', () => {
  const history = new History(10);
  history.push(entry(500, [], 'huge'));
  eq(history.undoStack.length, 1);
});

test('tile bounds clip to the texture', () => {
  eq(tileBounds([{ x: 0, y: 0 }, { x: 1, y: 2 }], 64, 512), {
    x: 0, y: 0, width: 128, height: 192,
  });
  eq(tileBounds([{ x: 7, y: 7 }], 64, 480), {
    x: 448, y: 448, width: 32, height: 32,
  });
});

test('sliceTile copies the right rows', () => {
  const size = 2;
  const bounds = { x: 0, y: 0, width: 4 };
  const source = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < source.length; i++) source[i] = i;
  const tile = sliceTile(source, bounds, 1, 1, size);
  // Tile (1,1) starts at texel (2,2), byte (2*4+2)*4 = 40.
  eq(tile[0], 40);
  eq(tile[8], 56);
});

test('undo tiles are 64 texels, as specified', () => eq(TILE, 64));

// Pressure ------------------------------------------------------------------------------------------

test('pressure curve', () => {
  eq(applyPressureCurve(0.5, 1), 0.5);
  ok(applyPressureCurve(0.5, 0.5) > 0.5, 'below 1 feels soft');
  ok(applyPressureCurve(0.5, 2) < 0.5, 'above 1 feels firm');
  eq(applyPressureCurve(-1, 1), 0);
  eq(applyPressureCurve(2, 1), 1);
});

// UVs --------------------------------------------------------------------------------------------------

const squareUv = [0, 0, 1, 0, 1, 1, 0, 1];
const squareIndex = [0, 1, 2, 0, 2, 3];

test('uv analysis: a clean layout is usable', () => {
  const result = analyzeUvs(squareIndex, squareUv);
  ok(result.usable);
  near(result.overlap, 1, 0.02);
});

test('uv analysis: stacked islands count as overlap', () => {
  const index = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const uv = [...squareUv, ...squareUv];
  const result = analyzeUvs(index, uv);
  ok(!result.usable);
  near(result.overlap, 2, 0.05);
});

test('uv analysis: UVs outside the square are flagged', () => {
  const uv = [0, 0, 2, 0, 2, 2, 0, 2];
  const result = analyzeUvs(squareIndex, uv);
  ok(!result.usable);
  eq(result.outside, 1);
});

test('uv analysis: all-zero UVs are empty', () => {
  ok(analyzeUvs(squareIndex, new Array(8).fill(0)).empty);
});

test('islands: joined triangles share one, separate ones do not', () => {
  const index = [0, 1, 2, 0, 2, 3, 4, 5, 6];
  const uv = [0, 0, 0.3, 0, 0.3, 0.3, 0, 0.3, 0.6, 0.6, 0.9, 0.6, 0.9, 0.9];
  const { triangleIsland, count } = computeIslands(index, uv);
  eq(count, 2);
  eq(triangleIsland[0], triangleIsland[1]);
  ok(triangleIsland[0] !== triangleIsland[2]);
});

test('islands: repeated vertices at the same UV still join', () => {
  // Two triangles with separate vertices that meet along a shared UV edge.
  const index = [0, 1, 2, 3, 4, 5];
  const uv = [0, 0, 0.5, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0.5];
  eq(computeIslands(index, uv).count, 1);
});

test('uv edges list each edge once', () => {
  const edges = uvEdges(squareIndex, squareUv);
  // 2 triangles have 6 edges, and the diagonal is shared: 5 unique, 4 numbers each.
  eq(edges.length, 20);
});

// Unwrap chunks ------------------------------------------------------------------------------------------

test('chunking keeps every triangle and respects the limit', () => {
  const index = [];
  for (let i = 0; i < 300; i++) index.push(i, i + 1, i + 2);
  const chunks = chunkMesh(index, 50);
  ok(chunks.length > 1);
  let triangles = 0;
  for (const chunk of chunks) {
    ok(chunk.vertices.length <= 50, 'chunk over the limit');
    triangles += chunk.indices.length / 3;
    for (const local of chunk.indices) ok(local < chunk.vertices.length);
  }
  eq(triangles, 300);
  // First triangle maps back to the original vertices.
  eq(chunks[0].indices.slice(0, 3).map((i) => chunks[0].vertices[i]), [0, 1, 2]);
});

// GLB --------------------------------------------------------------------------------------------------

const quad = {
  name: 'q',
  position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
  normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv: new Float32Array([0, 0, 1, 0, 1, 1]),
  index: new Uint16Array([0, 1, 2]),
};
const toon = {
  threshold: 0.5, softness: 0.04, edgeStrength: 0.35, rimColor: [0.6, 1, 0.85], rimPower: 3, rimStrength: 0,
};

test('glb: header, alignment and byte lengths are valid', () => {
  const buffer = writeGlb(quad);
  const view = new DataView(buffer);
  eq(view.getUint32(0, true), 0x46546c67, 'magic');
  eq(view.getUint32(4, true), 2, 'version');
  eq(view.getUint32(8, true), buffer.byteLength, 'length');
  eq(buffer.byteLength % 4, 0, 'alignment');
  const json = readGlbJson(buffer);
  eq(json.accessors[0].min, [0, 0, 0]);
  eq(json.accessors[0].max, [1, 1, 0]);
  eq(json.accessors[3].count, 3);
  ok(!json.extensionsUsed, 'a bare mesh has no extension');
});

test('glb: extension is used, not required, and textures are in order', () => {
  const png = new Uint8Array([1, 2, 3]);
  const json = readGlbJson(writeGlb({
    ...quad, litPng: png, shadowPng: png, edgePng: png, toon,
  }));
  eq(json.extensionsUsed, [TOON_EXTENSION]);
  ok(!json.extensionsRequired);
  const material = json.materials[0];
  eq(material.pbrMetallicRoughness.baseColorTexture.index, 0);
  const ext = material.extensions[TOON_EXTENSION];
  eq(ext.shadowTexture.index, 1);
  eq(ext.edgeTexture.index, 2);
  eq(ext.threshold, 0.5);
  eq(ext.rimColor, [0.6, 1, 0.85]);
  eq(json.images.length, 3);
});

test('glb: 32-bit indices use the right component type', () => {
  const json = readGlbJson(writeGlb({ ...quad, index: new Uint32Array([0, 1, 2]) }));
  eq(json.accessors[3].componentType, 5125);
});

// Palette ----------------------------------------------------------------------------------------------

const solidImage = (colors) => {
  const pixels = new Uint8Array(colors.length * 4 * 400);
  colors.forEach(([r, g, b], c) => {
    for (let i = 0; i < 400; i++) pixels.set([r, g, b, 255], (c * 400 + i) * 4);
  });
  return pixels;
};

test('k-means finds the colors that are there', () => {
  const palette = kmeansPalette(solidImage([[255, 0, 0], [0, 255, 0], [0, 0, 255]]), 3);
  eq([...palette].sort(), ['#0000ff', '#00ff00', '#ff0000']);
});

test('k-means is deterministic', () => {
  const pixels = solidImage([[200, 30, 10], [10, 100, 200], [240, 240, 90], [20, 20, 20]]);
  eq(kmeansPalette(pixels, 4), kmeansPalette(pixels, 4));
});

test('k-means ignores transparent pixels', () => {
  const pixels = new Uint8Array(4 * 100);
  for (let i = 0; i < 100; i++) pixels.set([255, 0, 0, 0], i * 4);
  eq(kmeansPalette(pixels, 4), []);
});

// Fill -------------------------------------------------------------------------------------------------

test('blendTexel: opaque paint replaces', () => {
  const pixels = new Uint8Array([10, 20, 30, 255]);
  blendTexel(pixels, 0, [200, 100, 50], 1, false);
  eq([...pixels], [200, 100, 50, 255]);
});

test('blendTexel: half opacity mixes', () => {
  const pixels = new Uint8Array([0, 0, 0, 255]);
  blendTexel(pixels, 0, [200, 100, 50], 0.5, false);
  eq([...pixels], [100, 50, 25, 255]);
});

test('blendTexel: paint on a transparent texel keeps its own color', () => {
  const pixels = new Uint8Array([9, 9, 9, 0]);
  blendTexel(pixels, 0, [200, 100, 50], 0.5, false);
  eq([pixels[0], pixels[1], pixels[2]], [200, 100, 50]);
  near(pixels[3], 128, 1);
});

test('blendTexel: Edge stays gray and opaque', () => {
  const pixels = new Uint8Array([128, 128, 128, 255]);
  blendTexel(pixels, 0, [255, 0, 0], 1, true);
  eq(pixels[0], pixels[1]);
  eq(pixels[3], 255);
  near(pixels[0], 54, 1, 'luma of red');
});

test('flood is clipped to the island', () => {
  // A 4x1 row, all one color, split into two islands down the middle.
  const res = 4;
  const pixels = new Uint8Array(res * res * 4).fill(255);
  const map = new Uint32Array(res * res);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) map[y * res + x] = x < 2 ? 1 : 2;
  }
  const flood = clippedFlood(pixels, res, map, 0, 0, 10);
  let filled = 0;
  for (let r = 0; r < flood.runs.length; r += 3) filled += flood.runs[r + 2];
  eq(filled, 8, 'should fill just the left half');
  applyFlood(pixels, res, flood, [1, 2, 3], 1, false, map, 1);
  eq(pixels[(0 * res + 2) * 4], 255, 'right half is untouched');
  eq(pixels[0], 1);
});

test('flood without islands fills everything that matches', () => {
  const res = 3;
  const pixels = new Uint8Array(res * res * 4).fill(100);
  const flood = clippedFlood(pixels, res, null, 1, 1, 10);
  let filled = 0;
  for (let r = 0; r < flood.runs.length; r += 3) filled += flood.runs[r + 2];
  eq(filled, 9);
});

// Color --------------------------------------------------------------------------------------------------

test('hsv and hex round trip', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#123456', '#c7402d', '#ffffff', '#000000', '#808080']) {
    const { h, s, v } = hexToHsv(hex);
    eq(hsvToHex(h, s, v), hex);
  }
});

test('hex parsing accepts what people type', () => {
  eq(parseHex('#ABCDEF'), '#abcdef');
  eq(parseHex('abc'), '#aabbcc');
  eq(parseHex(' 123456 '), '#123456');
  eq(parseHex('nope'), null);
  eq(parseHex('#12345'), null);
});

// Settings ----------------------------------------------------------------------------------------------

const key = (code, mods = {}) => ({
  code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
});

test('bindings: the spec defaults', () => {
  eq(actionFor(key('Digit1')), 'passLit');
  eq(actionFor(key('Digit3')), 'passEdge');
  eq(actionFor(key('KeyV')), 'previewCycle');
  eq(actionFor(key('KeyG')), 'toolFill');
  eq(actionFor(key('KeyI')), 'toolEyedropper');
  eq(actionFor(key('KeyF')), 'frame');
  eq(actionFor(key('Tab')), 'viewToggle');
  eq(actionFor(key('KeyZ', { ctrlKey: true })), 'undo');
  eq(actionFor(key('KeyZ', { ctrlKey: true, shiftKey: true })), 'redo');
  eq(actionFor(key('KeyY', { ctrlKey: true })), 'redoAlt');
  eq(actionFor(key('BracketLeft')), 'sizeDown');
  eq(actionFor(key('BracketRight', { shiftKey: true })), 'opacityUp');
});

test('bindings: fly keys only count during free-fly', () => {
  eq(actionFor(key('KeyW')), 'wire');
  eq(actionFor(key('KeyE')), 'toolEraser');
  eq(actionFor(key('KeyS')), null);
  eq(bindingFor('flyForward'), 'KeyW');
});

test('bindings: Cmd counts as Ctrl, and pretty names read well', () => {
  eq(bindingOf(key('KeyZ', { metaKey: true })), 'Ctrl+KeyZ');
  eq(prettyBinding('Ctrl+Shift+KeyZ'), 'Ctrl+Shift+Z');
  eq(prettyBinding('BracketLeft'), '[');
  eq(prettyBinding('Digit2'), '2');
});

test('dilation radius follows the texture size', () => {
  eq(dilationRadius(2048), 8);
  eq(dilationRadius(4096), 16);
  eq(dilationRadius(512), 4);
  eq(dilationRadius(2048, 4), 4);
});

// Runner -------------------------------------------------------------------------------------------------

let failed = 0;
const results = document.getElementById('results');
for (const { name, fn } of tests) {
  const line = document.createElement('div');
  try {
    await fn();
    line.className = 'pass';
    line.textContent = `ok  ${name}`;
  } catch (error) {
    failed++;
    line.className = 'fail';
    line.textContent = `FAIL ${name}: ${error.message}`;
  }
  results.append(line);
}
document.getElementById('summary').textContent = `${tests.length - failed}/${tests.length} passed`;
document.title = `${failed ? 'FAIL' : 'ok'}: Splotchle 3D tests`;
window.testResults = { total: tests.length, failed };
