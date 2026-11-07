// Writes the test models into ../test-assets. Run with: node modelpainter/tools/make-test-assets.mjs
// The committed .glb files are the output, so this only needs running to change them.
//
//   cube-seams.glb   6 faces laid out as separate islands. The first thing to check after any
//                    painting change, because strokes must carry straight across its hard UV seams.
//   uv-sphere.glb    Classic lat-long UVs, stretched at the poles.
//   character.glb    A low-poly figure whose parts all use the same 0..1 UV square, so importing it
//                    must detect the overlap and suggest an unwrap.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGlb } from '../js/io/glb.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-assets');
mkdirSync(out, { recursive: true });

const save = (name, buffer) => writeFileSync(join(out, name), Buffer.from(buffer));

/** Builds one face of a box as a quad with its own UV rectangle. */
function pushQuad(mesh, corners, normal, [u0, v0, u1, v1]) {
  const base = mesh.position.length / 3;
  const uvs = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
  corners.forEach((corner, i) => {
    mesh.position.push(...corner);
    mesh.normal.push(...normal);
    mesh.uv.push(...uvs[i]);
  });
  mesh.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A box centered at (cx, cy, cz). rects gives each face's UV rectangle, in +x -x +y -y +z -z order. */
function pushBox(mesh, [cx, cy, cz], [sx, sy, sz], rects) {
  const x = sx / 2;
  const y = sy / 2;
  const z = sz / 2;
  const p = (dx, dy, dz) => [cx + dx, cy + dy, cz + dz];
  pushQuad(mesh, [p(x, -y, z), p(x, -y, -z), p(x, y, -z), p(x, y, z)], [1, 0, 0], rects[0]);
  pushQuad(mesh, [p(-x, -y, -z), p(-x, -y, z), p(-x, y, z), p(-x, y, -z)], [-1, 0, 0], rects[1]);
  pushQuad(mesh, [p(-x, y, z), p(x, y, z), p(x, y, -z), p(-x, y, -z)], [0, 1, 0], rects[2]);
  pushQuad(mesh, [p(-x, -y, -z), p(x, -y, -z), p(x, -y, z), p(-x, -y, z)], [0, -1, 0], rects[3]);
  pushQuad(mesh, [p(-x, -y, z), p(x, -y, z), p(x, y, z), p(-x, y, z)], [0, 0, 1], rects[4]);
  pushQuad(mesh, [p(x, -y, -z), p(-x, -y, -z), p(-x, y, -z), p(x, y, -z)], [0, 0, -1], rects[5]);
}

const empty = () => ({
  position: [], normal: [], uv: [], index: [],
});

const typed = ({
  position, normal, uv, index,
}) => ({
  position: new Float32Array(position),
  normal: new Float32Array(normal),
  uv: new Float32Array(uv),
  index: position.length / 3 > 65535 ? new Uint32Array(index) : new Uint16Array(index),
});

// --- Cube: a 3x2 grid of faces with gaps, and each face rotated its own way in the atlas ---------
{
  const mesh = empty();
  const gap = 0.02;
  const w = (1 - gap * 4) / 3;
  const h = (1 - gap * 3) / 2;
  const rect = (col, row) => [gap + col * (w + gap), gap + row * (h + gap), gap + col * (w + gap) + w, gap + row * (h + gap) + h];
  pushBox(mesh, [0, 0, 0], [1, 1, 1], [rect(0, 0), rect(1, 0), rect(2, 0), rect(0, 1), rect(1, 1), rect(2, 1)]);
  save('cube-seams.glb', writeGlb({ name: 'cube-seams', ...typed(mesh) }));
}

// --- Sphere --------------------------------------------------------------------------------------
{
  const mesh = empty();
  const rings = 32;
  const segments = 64;
  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const polar = v * Math.PI;
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const around = u * Math.PI * 2;
      const nx = -Math.cos(around) * Math.sin(polar);
      const ny = Math.cos(polar);
      const nz = Math.sin(around) * Math.sin(polar);
      mesh.position.push(nx, ny, nz);
      mesh.normal.push(nx, ny, nz);
      mesh.uv.push(u, v);
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x;
      const b = a + segments + 1;
      if (y > 0) mesh.index.push(a, a + 1, b);
      if (y < rings - 1) mesh.index.push(a + 1, b + 1, b);
    }
  }
  save('uv-sphere.glb', writeGlb({ name: 'uv-sphere', ...typed(mesh) }));
}

// --- Character: an original blocky figure. Every box reuses the whole UV square --------------------
{
  const mesh = empty();
  const whole = [0, 0, 1, 1];
  const all = [whole, whole, whole, whole, whole, whole];
  const parts = [
    [[0, 1.55, 0], [0.5, 0.5, 0.5]], // head
    [[-0.13, 1.6, 0.26], [0.09, 0.12, 0.03]], // eyes
    [[0.13, 1.6, 0.26], [0.09, 0.12, 0.03]],
    [[0, 0.98, 0], [0.62, 0.72, 0.34]], // body
    [[-0.44, 1.02, 0], [0.2, 0.68, 0.22]], // arms
    [[0.44, 1.02, 0], [0.2, 0.68, 0.22]],
    [[-0.17, 0.32, 0], [0.24, 0.64, 0.26]], // legs
    [[0.17, 0.32, 0], [0.24, 0.64, 0.26]],
    [[-0.17, 0.04, 0.05], [0.26, 0.09, 0.38]], // feet
    [[0.17, 0.04, 0.05], [0.26, 0.09, 0.38]],
  ];
  for (const [center, size] of parts) pushBox(mesh, center, size, all);
  save('character.glb', writeGlb({ name: 'character', ...typed(mesh) }));
}

console.log('Wrote test models to', out);
