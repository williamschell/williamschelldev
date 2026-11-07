// End-to-end tests. They drive the real app in Chrome, using real pointer input, and check what ends
// up in the textures. This isn't part of the site and nothing needs it at runtime.
//
//   npm install --no-save playwright-core     (anywhere, then point PLAYWRIGHT at it)
//   python -m http.server 8123                (from the repo root)
//   PLAYWRIGHT=/path/to/node_modules/playwright-core node modelpainter/tests/e2e.mjs
//
// Optional: BASE_URL, CHROME (path to the browser), SHOTS (folder for screenshots).

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright-core');

const BASE = process.env.BASE_URL ?? 'http://localhost:8123/modelpainter/';
const SHOTS = process.env.SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(`${e.message}\n${e.stack}`));

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const settle = () => page.waitForTimeout(120);

// Reads from the running app. Passes hold top-row-first bytes, addressed by texel.
const texel = (pass, u, v) => page.evaluate(([p, a, b]) => {
  const { passes } = window.splotch3d.engine;
  const res = passes.res;
  return [...passes.readTexel(p, Math.floor(a * res), Math.floor(b * res))];
}, [pass, u, v]);

/** Hashes a whole pass, to compare states without shipping megabytes across. */
const passHash = (pass) => page.evaluate((p) => {
  const data = window.splotch3d.engine.passes.readPass(p);
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 7) h = Math.imul(h ^ data[i], 16777619);
  return h >>> 0;
}, pass);

/** Counts texels in a pass that differ from a first read, for how much a change touched. */
const countDifferent = async (pass, snapshotName) => page.evaluate(([p, name]) => {
  const data = window.splotch3d.engine.passes.readPass(p);
  const before = window.__snapshots[name];
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== before[i] || data[i + 1] !== before[i + 1] || data[i + 2] !== before[i + 2] || data[i + 3] !== before[i + 3]) n++;
  }
  return n;
}, [pass, snapshotName]);

const snapshot = (pass, name) => page.evaluate(([p, n]) => {
  window.__snapshots ??= {};
  window.__snapshots[n] = window.splotch3d.engine.passes.readPass(p);
}, [pass, name]);

async function viewportBox() {
  return page.locator('#gl').boundingBox();
}

/** Draws with the real mouse, in canvas coordinates. */
async function drag(points, button = 'left') {
  const box = await viewportBox();
  const at = ([x, y]) => [box.x + x, box.y + y];
  await page.mouse.move(...at(points[0]));
  await page.mouse.down({ button });
  for (let i = 1; i < points.length; i++) await page.mouse.move(...at(points[i]), { steps: 8 });
  await page.mouse.up({ button });
  await settle();
}

/** Draws with a synthetic pen, since Playwright's mouse has no pressure. */
async function penStroke(points) {
  await page.evaluate((pts) => {
    const canvas = document.getElementById('gl');
    const box = canvas.getBoundingClientRect();
    const fire = (type, [x, y, pressure], buttons) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      pointerId: 77,
      pointerType: 'pen',
      clientX: box.left + x,
      clientY: box.top + y,
      pressure,
      button: type === 'pointermove' ? -1 : 0,
      buttons,
    }));
    fire('pointerdown', pts[0], 1);
    for (const p of pts.slice(1)) fire('pointermove', p, 1);
    fire('pointerup', pts[pts.length - 1], 0);
  }, points);
  await settle();
}

const setBrush = (key) => page.keyboard.press(key);

async function setColor(hex) {
  await page.evaluate(() => document.activeElement?.blur?.());
  const input = page.locator('.hex-row input');
  await input.fill(hex);
  await input.press('Enter');
  await page.locator('#gl').focus();
}

/** Opens a sample from the home screen. */
async function openSample(name) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])') && document.querySelector('#workspace:not([hidden])'), undefined, { timeout: 120000 });
  await page.waitForTimeout(300);
}

const goHomeIfNeeded = async () => {
  if (await page.locator('#workspace').isVisible()) await goHome();
};

const goHome = async () => {
  await page.locator('#go-home').click();
  await page.waitForSelector('#home:not([hidden])', { timeout: 60000 });
  await page.waitForTimeout(200);
};

try {
  await page.goto(BASE);
  await page.waitForSelector('text=Paint it twice');
  // A clean slate, in case an earlier run left projects behind.
  await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('modelpainter');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  }));
  await page.reload();
  await page.waitForSelector('text=Paint it twice');

  // Viewer -------------------------------------------------------------------------------------
  await openSample('Cube with hard seams');
  await shot('01-cube');
  check('workspace opens', await page.locator('#workspace').isVisible());
  check('edge pass starts at neutral gray', (await texel('edge', 0.2, 0.2))[0] === 128 || (await texel('edge', 0.2, 0.2))[0] === 127);

  // Painting on the model ------------------------------------------------------------------------
  // Cube face colors at start. Camera faces +z and +x, so this stroke crosses the hard seam between them.
  await setColor('#d02020');
  await setBrush('KeyP'); // pen
  await snapshot('lit', 'before-seam');
  const box = await viewportBox();
  const cx = box.width / 2;
  const cy = box.height / 2 + 30;
  await drag([[cx - 130, cy], [cx + 120, cy + 10]]);
  await shot('02-seam-stroke');
  const painted = await countDifferent('lit', 'before-seam');
  check('stroke in 3D reaches the texture', painted > 500, `${painted} texels`);

  // The stroke crosses the seam into another island, so more than one must hold paint. Each island
  // is one cube face, and their UV rectangles sit in a 3x2 grid.
  const islandsTouched = await page.evaluate(() => {
    const { passes, islands, islandMap, project } = window.splotch3d.engine;
    const data = passes.readPass('lit');
    const map = islandMap.get(project.geometry, islands.triangleIsland, passes.res);
    const seen = new Set();
    for (let i = 0; i < map.length; i++) {
      if (map[i] && data[i * 4] > 180 && data[i * 4 + 1] < 90) seen.add(map[i]);
    }
    return seen.size;
  });
  check('a stroke crosses the UV seam onto both faces', islandsTouched >= 2, `${islandsTouched} islands`);

  // Undo ------------------------------------------------------------------------------------------
  const paintedHash = await passHash('lit');
  await page.keyboard.press('Control+z');
  await settle();
  check('undo restores every texel', (await countDifferent('lit', 'before-seam')) === 0);
  await page.keyboard.press('Control+Shift+z');
  await settle();
  check('redo brings the stroke back', (await passHash('lit')) === paintedHash);
  await page.keyboard.press('Control+y');
  await settle();

  // Seam dilation: padding around islands should follow the paint, so mipmaps can't show seams.
  const dilated = await page.evaluate(() => {
    const { passes, islandMap, islands, project } = window.splotch3d.engine;
    const { res } = passes;
    const data = passes.readPass('lit');
    const map = islandMap.get(project.geometry, islands.triangleIsland, res);
    let padded = 0;
    for (let y = 1; y < res - 1; y++) {
      for (let x = 1; x < res - 1; x++) {
        const i = y * res + x;
        if (map[i] === 0 && data[i * 4] > 180 && data[i * 4 + 1] < 90) padded++;
      }
    }
    return padded;
  });
  check('paint dilates into the empty space around islands', dilated > 0, `${dilated} padding texels`);

  // Occlusion: painting must not leak onto hidden faces.
  const hiddenFaces = await page.evaluate(() => {
    const { passes } = window.splotch3d.engine;
    const data = passes.readPass('lit');
    const { res } = passes;
    // Face rectangles: rect(1,0) is -x and rect(0,1) is -y, both turned away from this camera.
    const gap = 0.02;
    const w = (1 - gap * 4) / 3;
    const h = (1 - gap * 3) / 2;
    const redIn = (col, row) => {
      let n = 0;
      const x0 = Math.floor((gap + col * (w + gap)) * res);
      const y0 = Math.floor((gap + row * (h + gap)) * res);
      for (let y = y0; y < y0 + h * res; y += 4) {
        for (let x = x0; x < x0 + w * res; x += 4) {
          const o = (y * res + x) * 4;
          if (data[o] > 180 && data[o + 1] < 90) n++;
        }
      }
      return n;
    };
    return redIn(1, 0) + redIn(0, 1);
  });
  check('paint does not leak onto faces turned away', hiddenFaces === 0, `${hiddenFaces} samples`);

  // Pass switching and helpers --------------------------------------------------------------------
  await page.keyboard.press('Digit2');
  check('2 switches to Shadow', await page.evaluate(() => window.splotch3d.engine.pass === 'shadow'));
  await page.keyboard.press('Digit3');
  check('3 switches to Edge', await page.evaluate(() => window.splotch3d.engine.pass === 'edge'));
  await page.keyboard.press('Digit1');

  await page.getByText('Pass helpers').click();
  await page.getByRole('button', { name: 'Generate shadow from lit' }).click();
  await settle();
  const litSample = await texel('lit', 0.2, 0.2);
  const shadowSample = await texel('shadow', 0.2, 0.2);
  const lum = ([r, g, b]) => r + g + b;
  check('generated shadow is darker than lit', lum(shadowSample) < lum(litSample), `${litSample} -> ${shadowSample}`);
  check('generated shadow leans blue', shadowSample[2] / Math.max(1, shadowSample[0]) > litSample[2] / Math.max(1, litSample[0]));
  await page.keyboard.press('Control+z');
  await settle();
  await page.getByRole('button', { name: 'Copy lit → shadow' }).click();
  await settle();
  check('copy lit to shadow', JSON.stringify(await texel('shadow', 0.2, 0.2)) === JSON.stringify(litSample));
  await page.keyboard.press('Control+z');
  await settle();

  // Edge pass -------------------------------------------------------------------------------------
  await page.keyboard.press('Digit3');
  await setColor('#ffffff');
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Tab'); // UV view makes coordinates easy
  await settle();
  await page.evaluate(() => { window.splotch3d.engine.uv.fit(); });
  await shot('03-uv-edge');
  await snapshot('edge', 'edge-before');
  const toCanvas = (u, v) => page.evaluate(([a, b]) => {
    const { uv } = window.splotch3d.engine;
    return [uv.panX + a * uv.zoom, uv.panY + b * uv.zoom];
  }, [u, v]);
  const eStart = await toCanvas(0.1, 0.25);
  const eEnd = await toCanvas(0.3, 0.25);
  await drag([eStart, eEnd]);
  const edgeMark = await texel('edge', 0.2, 0.25);
  check('painting Edge raises the value', edgeMark[0] > 140, String(edgeMark));
  check('Edge stays grayscale and opaque', edgeMark[0] === edgeMark[1] && edgeMark[1] === edgeMark[2] && edgeMark[3] === 255);
  await page.keyboard.press('KeyE');
  await page.evaluate(() => { window.splotch3d.engine.tool.eraser.size = 60; });
  await drag([eStart, eEnd]);
  const edgeErased = await texel('edge', 0.2, 0.25);
  check('eraser takes Edge back to 50% gray', Math.abs(edgeErased[0] - 128) <= 1, String(edgeErased));
  await page.getByRole('button', { name: 'Reset edge to gray' }).click();
  await settle();
  await page.keyboard.press('Digit1');

  // Eraser on Lit ---------------------------------------------------------------------------------
  const litBefore = await texel('lit', 0.2, 0.25);
  await drag([eStart, eEnd]);
  const litErased = await texel('lit', 0.2, 0.25);
  check('eraser on Lit goes transparent', litErased[3] === 0 && litBefore[3] === 255, String(litErased));
  await page.keyboard.press('Control+z');
  await settle();

  // Brushes, in the UV view -----------------------------------------------------------------------
  await page.keyboard.press('KeyM');
  const tool = (changes) => page.evaluate((c) => {
    const { engine } = window.splotch3d;
    Object.assign(engine.brushSettings, c);
  }, changes);
  await tool({ size: 30, opacity: 1 });
  await setColor('#000000');
  // Marker: a stroke that goes over itself must not get darker where it crosses.
  const a = await toCanvas(0.05, 0.1);
  const b = await toCanvas(0.3, 0.1);
  await drag([a, b, a, b]);
  const once = await texel('lit', 0.175, 0.1);
  const lay = await toCanvas(0.175, 0.1);
  await shot('04-marker');
  check('marker is see-through', once[0] > 30 && once[0] < 150, String(once));
  // A second stroke across it does get darker, because that's a new stroke.
  await drag([[lay[0], lay[1] - 30], [lay[0], lay[1] + 30]]);
  const twice = await texel('lit', 0.175, 0.1);
  check('marker builds up across strokes', twice[0] < once[0] - 15, `${once[0]} -> ${twice[0]}`);
  const c1 = await texel('lit', 0.12, 0.1);
  const c2 = await texel('lit', 0.24, 0.1);
  check('marker does not build up within a stroke', Math.abs(c1[0] - once[0]) <= 2 && Math.abs(c2[0] - once[0]) <= 2, `${c1[0]}, ${c2[0]}, ${once[0]}`);

  // Pen pressure: heavier pressure means a wider line.
  await page.keyboard.press('KeyP');
  await tool({ size: 20, opacity: 1 });
  await snapshot('lit', 'press0');
  const p1 = await toCanvas(0.05, 0.55);
  const p2 = await toCanvas(0.3, 0.55);
  const line = (pressure) => {
    const out = [];
    for (let i = 0; i <= 20; i++) out.push([p1[0] + ((p2[0] - p1[0]) * i) / 20, p1[1], pressure]);
    return out;
  };
  await penStroke(line(0.15));
  const light = await countDifferent('lit', 'press0');
  await page.keyboard.press('Control+z');
  await settle();
  await penStroke(line(0.95));
  const heavy = await countDifferent('lit', 'press0');
  await page.keyboard.press('Control+z');
  await settle();
  check('pen: pressure changes the width', heavy > light * 2, `${light} vs ${heavy} texels`);

  // Pencil: pressure mostly changes strength, not width.
  await page.keyboard.press('KeyN');
  await tool({ size: 20, opacity: 1 });
  await penStroke(line(0.1));
  const faint = await texel('lit', 0.175, 0.55);
  await page.keyboard.press('Control+z');
  await settle();
  await penStroke(line(1));
  const strong = await texel('lit', 0.175, 0.55);
  await page.keyboard.press('Control+z');
  await settle();
  check('pencil: pressure changes the strength', lum(strong) < lum(faint), `${faint} vs ${strong}`);

  // Paintbrush, with a good look at the bristles.
  await page.keyboard.press('KeyB');
  await tool({ size: 60, opacity: 1 });
  await setColor('#2060c0');
  const q1 = await toCanvas(0.36, 0.1);
  const q2 = await toCanvas(0.62, 0.3);
  const q3 = await toCanvas(0.4, 0.42);
  await drag([q1, q2, q3]);
  await shot('05-paintbrush');
  const bristleShades = await page.evaluate(() => {
    const { passes } = window.splotch3d.engine;
    const { res } = passes;
    const data = passes.readPass('lit');
    const seen = new Set();
    for (let y = Math.floor(res * 0.05); y < res * 0.45; y += 3) {
      for (let x = Math.floor(res * 0.35); x < res * 0.65; x += 3) {
        const o = (y * res + x) * 4;
        if (data[o + 2] > data[o] + 40) seen.add((data[o] >> 2) << 12 | (data[o + 1] >> 2) << 6 | (data[o + 2] >> 2));
      }
    }
    return seen.size;
  });
  check('paintbrush shows separately shaded bristles', bristleShades > 6, `${bristleShades} shades`);

  // Opacity: applied once to the finished stroke.
  await page.keyboard.press('KeyP');
  await tool({ size: 30, opacity: 0.5 });
  await setColor('#000000');
  const o1 = await toCanvas(0.7, 0.1);
  const o2 = await toCanvas(0.95, 0.1);
  const underO = await texel('lit', 0.82, 0.1);
  await drag([o1, o2, o1]);
  const halfO = await texel('lit', 0.82, 0.1);
  check('opacity applies once per stroke', Math.abs(halfO[0] - underO[0] / 2) <= 6, `${underO[0]} -> ${halfO[0]}`);
  await tool({ opacity: 1 });

  // Fill ------------------------------------------------------------------------------------------
  await page.keyboard.press('KeyG');
  await setColor('#20a040');
  const islandPoint = await toCanvas(0.5, 0.75);
  const insideOther = await texel('lit', 0.15, 0.75);
  await drag([islandPoint, islandPoint]);
  const filled = await texel('lit', 0.5, 0.75);
  check('island fill colors the clicked island', filled[1] === 160 && filled[0] === 32, String(filled));
  check('island fill stays in that island', JSON.stringify(await texel('lit', 0.15, 0.75)) === JSON.stringify(insideOther));
  await page.keyboard.press('Control+z');
  await settle();

  await page.getByText('Fill and eyedropper').click();
  await page.locator('input[name="fill-mode"][value="connected"]').check({ force: true });
  await setColor('#e0c020');
  // Fill the paintbrush's island area around a drawn black mark: it should stop at the mark.
  await page.keyboard.press('KeyP');
  await tool({ size: 14, opacity: 1 });
  await setColor('#000000');
  const r1 = await toCanvas(0.42, 0.72);
  const r2 = await toCanvas(0.58, 0.72);
  const r3 = await toCanvas(0.58, 0.85);
  const r4 = await toCanvas(0.42, 0.85);
  await drag([r1, r2, r3, r4, r1]);
  await page.keyboard.press('KeyG');
  await setColor('#e0c020');
  const inRing = await toCanvas(0.5, 0.78);
  await drag([inRing, inRing]);
  const ringFilled = await texel('lit', 0.5, 0.78);
  const ringOutside = await texel('lit', 0.38, 0.92);
  await shot('06-connected-fill');
  check('connected fill fills inside the drawn ring', ringFilled[0] === 224 && ringFilled[2] === 32, String(ringFilled));
  check('connected fill stops at the line', ringOutside[0] !== 224, String(ringOutside));

  await page.locator('input[name="fill-mode"][value="whole"]').check({ force: true });
  await setColor('#808080');
  await page.keyboard.press('Digit2');
  await drag([inRing, inRing]);
  const whole = await texel('shadow', 0.01, 0.01);
  check('whole-object fill covers the pass', whole[0] === 128, String(whole));
  await page.keyboard.press('Control+z');
  await settle();
  await page.keyboard.press('Digit1');
  await page.locator('input[name="fill-mode"][value="island"]').check({ force: true });

  // Eyedropper ------------------------------------------------------------------------------------
  await page.keyboard.press('KeyI');
  await drag([inRing, inRing]);
  check('eyedropper reads the pass texel', (await page.locator('.hex-row input').inputValue()) === '#e0c020');
  await page.keyboard.press('KeyB');
  await setColor('#112233');
  await page.keyboard.down('Alt');
  await drag([inRing, inRing]);
  await page.keyboard.up('Alt');
  check('Alt samples with any brush', (await page.locator('.hex-row input').inputValue()) === '#e0c020');

  // Previews --------------------------------------------------------------------------------------
  await page.keyboard.press('Tab');
  await settle();
  const before = await page.evaluate(() => window.splotch3d.engine.preview);
  await page.keyboard.press('KeyV');
  const afterV = await page.evaluate(() => window.splotch3d.engine.preview);
  check('V cycles the preview mode', before === 'toon' && afterV === 'lit', `${before} -> ${afterV}`);
  await shot('07-lit-only');
  await page.keyboard.press('KeyV');
  await shot('08-shadow-only');
  await page.keyboard.press('KeyV');
  await page.keyboard.press('KeyV');

  // Camera ----------------------------------------------------------------------------------------
  const cameraState = () => page.evaluate(() => {
    const { rig } = window.splotch3d.engine;
    return { p: rig.position.toArray(), yaw: rig.yaw, pitch: rig.pitch };
  });
  await page.mouse.move(box.x + cx, box.y + cy);
  const cam0 = await cameraState();
  await drag([[cx, cy], [cx + 90, cy + 20]], 'middle');
  const cam1 = await cameraState();
  check('middle drag orbits', cam1.yaw !== cam0.yaw && cam1.pitch !== cam0.pitch);
  const pivotDistance = await page.evaluate(() => window.splotch3d.engine.rig.pivot.length());
  check('the orbit pivot is the surface point under the cursor', pivotDistance > 0.45 && pivotDistance < 0.95, pivotDistance.toFixed(2));
  await page.keyboard.down('Shift');
  await drag([[cx, cy], [cx + 40, cy]], 'middle');
  await page.keyboard.up('Shift');
  const cam2 = await cameraState();
  check('Shift + middle pans', cam2.yaw === cam1.yaw && cam2.p[0] !== cam1.p[0]);
  await page.mouse.move(box.x + cx, box.y + cy);
  const dist0 = await page.evaluate(() => window.splotch3d.engine.rig.position.length());
  await page.mouse.wheel(0, -200);
  await settle();
  const dist1 = await page.evaluate(() => window.splotch3d.engine.rig.position.length());
  check('scrolling zooms in', dist1 < dist0, `${dist0.toFixed(2)} -> ${dist1.toFixed(2)}`);
  await page.keyboard.press('KeyF');
  await settle();
  const framed = await page.evaluate(() => window.splotch3d.engine.rig.position.distanceTo(window.splotch3d.engine.rig.center));
  check('F frames the model', framed > 1.5 && framed < 8, framed.toFixed(2));

  // Space scheme, for pens with no barrel buttons
  const s0 = await cameraState();
  await page.keyboard.down('Space');
  await drag([[cx, cy], [cx + 60, cy]]);
  await page.keyboard.up('Space');
  const s1 = await cameraState();
  check('Space + drag orbits', s1.yaw !== s0.yaw);
  await page.keyboard.down('Space');
  await page.keyboard.down('Control');
  await drag([[cx, cy], [cx, cy - 60]]);
  await page.keyboard.up('Control');
  await page.keyboard.up('Space');
  const s2 = await cameraState();
  check('Space + Ctrl + drag zooms', s2.yaw === s1.yaw && s2.p[2] !== s1.p[2]);

  // Free-fly: Playwright can hold right + a key, though pointer lock may not engage in headless.
  await page.mouse.move(box.x + cx, box.y + cy);
  const f0 = await cameraState();
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + cx + 50, box.y + cy, { steps: 4 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  await page.mouse.up({ button: 'right' });
  const f1 = await cameraState();
  check('right-hold + WASD flies', f1.p[0] !== f0.p[0] || f1.p[2] !== f0.p[2]);
  await page.keyboard.press('KeyF');
  await settle();

  // Light: L + drag
  const l0 = await page.evaluate(() => window.splotch3d.engine.project.light.azimuth);
  await page.keyboard.down('KeyL');
  await drag([[cx, cy], [cx + 80, cy]]);
  await shot('09-light-drag');
  await page.keyboard.up('KeyL');
  const l1 = await page.evaluate(() => window.splotch3d.engine.project.light.azimuth);
  check('L + drag moves the light', l1 !== l0, `${l0} -> ${l1}`);

  // Split view
  await page.keyboard.press('Shift+Tab');
  await settle();
  await shot('10-split');
  check('Shift+Tab opens split view', await page.evaluate(() => window.splotch3d.engine.viewMode === 'split'));
  await page.keyboard.press('Shift+Tab');
  await settle();

  // Pointer leaving and the context menu
  check('context menu is blocked on the canvas', await page.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.getElementById('gl').dispatchEvent(e);
    return e.defaultPrevented;
  }));

  // Palette grabber ---------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Grab from the current pass' }).click();
  await page.waitForFunction(() => window.splotch3d.engine.project.palette.length > 0, undefined, { timeout: 30000 });
  const palette = await page.evaluate(() => window.splotch3d.engine.project.palette);
  check('palette grabber finds colors', palette.length >= 4 && palette.every((c) => /^#[0-9a-f]{6}$/.test(c)), palette.join(' '));

  // Saving and reopening ---------------------------------------------------------------------------
  // Everything in this test file so far has been painted on Lit, so that's the pass to compare.
  const hashes = {};
  for (const pass of ['lit', 'shadow', 'edge']) hashes[pass] = await passHash(pass);

  const downloadFrom = async (name) => {
    await page.locator('#export-btn').click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name }).click()]);
    const path = await download.path();
    return { path, file: download.suggestedFilename() };
  };

  const glb = await downloadFrom(/Export GLB for the game/);
  const glbBytes = readFileSync(glb.path);
  const jsonLength = glbBytes.readUInt32LE(12);
  const json = JSON.parse(glbBytes.subarray(20, 20 + jsonLength).toString());
  check('GLB export is named after the project', glb.file.endsWith('.glb'), glb.file);
  check('GLB declares the extension as used', json.extensionsUsed?.includes('WSCHELL_toon_paint'));
  check('GLB does not require the extension', !json.extensionsRequired);
  const material = json.materials[0];
  const ext = material.extensions.WSCHELL_toon_paint;
  check('GLB base color is the Lit pass', material.pbrMetallicRoughness.baseColorTexture.index === 0);
  check('GLB extension points at shadow and edge', ext.shadowTexture.index === 1 && ext.edgeTexture.index === 2);
  check('GLB has the shader settings', ext.threshold === 0.5 && ext.softness === 0.04 && ext.edgeStrength === 0.35 && ext.rimPower === 3);

  const project = await downloadFrom(/Save project file/);
  check('project file is a .splotch3d', project.file.endsWith('.splotch3d'), project.file);

  const png = await downloadFrom(/Export Shadow PNG/);
  check('PNG export', readFileSync(png.path).subarray(1, 4).toString() === 'PNG');
  await page.keyboard.press('Escape');

  // Autosave round trip
  await page.waitForTimeout(500);
  await goHome();
  await shot('11-home-with-projects');
  const card = page.locator('.project-card').first();
  check('project list shows the project', await card.isVisible());
  check('project list shows a thumbnail', (await card.locator('img').count()) === 1);
  await card.locator('.project-open').click();
  await page.waitForSelector('#workspace:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])'));
  await page.waitForTimeout(300);
  for (const pass of ['lit', 'shadow', 'edge']) {
    check(`autosave keeps ${pass}`, (await passHash(pass)) === hashes[pass]);
  }
  check('autosave keeps the palette', (await page.evaluate(() => window.splotch3d.engine.project.palette.length)) === palette.length);
  await shot('12-reopened');
  await goHome();

  // Project file round trip
  await page.setInputFiles('input[type="file"]', { name: 'copy.splotch3d', mimeType: 'application/zip', buffer: readFileSync(project.path) });
  await page.waitForSelector('#workspace:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])'));
  await page.waitForTimeout(300);
  for (const pass of ['lit', 'shadow', 'edge']) {
    check(`.splotch3d keeps ${pass}`, (await passHash(pass)) === hashes[pass]);
  }
  await goHome();

  // Re-import the exported GLB. Painted data comes back from the extension.
  await page.setInputFiles('input[type="file"]', { name: 'exported.glb', mimeType: 'model/gltf-binary', buffer: glbBytes });
  await page.waitForSelector('#workspace:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])'));
  await page.waitForTimeout(300);
  const reimported = await page.evaluate(() => window.splotch3d.engine.project.shader.edgeStrength);
  check('exported GLB imports with its shader settings', reimported === 0.35);
  check('exported GLB brings the painted Lit pass back', (await texel('lit', 0.5, 0.78))[0] === 224, String(await texel('lit', 0.5, 0.78)));
  await goHome();

  // Unwrapping ---------------------------------------------------------------------------------------
  await openSample('Low-poly character');
  await page.waitForSelector('dialog[open]', { timeout: 30000 });
  await shot('13-overlap-prompt');
  check('overlapping UVs are detected on import', await page.getByText('Unwrap this model?').isVisible());
  await page.getByRole('button', { name: 'Keep its UVs' }).click();
  await settle();
  // Paint first, so unwrap has paint to carry across.
  await setColor('#d02020');
  await page.keyboard.press('KeyP');
  await page.evaluate(() => { window.splotch3d.engine.tool.perBrush.pen.size = 40; });
  await drag([[cx - 60, cy - 40], [cx + 60, cy - 40]]);
  const paintedRed = await page.evaluate(() => {
    const { passes } = window.splotch3d.engine;
    const data = passes.readPass('lit');
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 180 && data[i + 1] < 90) n++;
    return n;
  });
  check('painted the character', paintedRed > 100, `${paintedRed} texels`);
  await snapshot('lit', 'preUnwrap');
  await page.getByText('UVs', { exact: true }).click();
  await page.getByRole('button', { name: 'Auto unwrap' }).click();
  await page.waitForSelector('dialog[open]');
  await page.getByRole('button', { name: 'Unwrap', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])') && !document.querySelector('dialog[open]'), undefined, { timeout: 120000 });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const { engine } = window.splotch3d;
    const { attributes, index } = engine.project.geometry;
    const uv = attributes.uv.array;
    let min = Infinity;
    let max = -Infinity;
    for (const value of uv) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const { passes } = engine;
    const data = passes.readPass('lit');
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 110) red++;
    return {
      min, max, red, islands: engine.islands.count, triangles: index.count / 3,
    };
  });
  check('unwrap keeps UVs in the 0..1 square', after.min >= -0.0001 && after.max <= 1.0001, `${after.min.toFixed(4)}..${after.max.toFixed(4)}`);
  check('unwrap makes several islands', after.islands > 3, `${after.islands} islands`);
  check('unwrap keeps every triangle', after.triangles === 120, `${after.triangles}`);
  check('paint is carried over to the new layout', after.red > 20, `${after.red} texels`);
  const analysis = await page.evaluate(async () => {
    const { analyzeUvs } = await import('./js/mesh/uvs.js');
    const g = window.splotch3d.engine.project.geometry;
    return analyzeUvs(g.index.array, g.attributes.uv.array);
  });
  check('the new layout has no overlap', analysis.usable, `overlap ${analysis.overlap.toFixed(3)}`);
  await page.keyboard.press('Tab');
  await settle();
  await shot('14-unwrapped-uv');
  await page.keyboard.press('Tab');
  await settle();
  await shot('15-unwrapped-3d');

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  check('undo restores the old layout and paint', (await countDifferent('lit', 'preUnwrap')) === 0);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  check('redo reapplies the unwrap', await page.evaluate(() => window.splotch3d.engine.islands.count > 3));

  // Painting on the unwrapped model still works.
  await snapshot('lit', 'postUnwrap');
  await drag([[cx - 40, cy + 30], [cx + 40, cy + 30]]);
  check('painting works after an unwrap', (await countDifferent('lit', 'postUnwrap')) > 50);

  // Resolution --------------------------------------------------------------------------------------
  await page.getByText('Project', { exact: true }).click();
  await page.getByLabel('Texture resolution').selectOption('1024');
  await page.waitForFunction(() => window.splotch3d.engine.passes.res === 1024 && !document.querySelector('#busy:not([hidden])'), undefined, { timeout: 60000 });
  const resized = await page.evaluate(() => {
    const { passes } = window.splotch3d.engine;
    const data = passes.readPass('lit');
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 110) red++;
    return red;
  });
  check('changing resolution keeps the paint', resized > 20, `${resized} texels at 1024`);
  await goHome();

  // Key remapping -------------------------------------------------------------------------------------
  await page.locator('#settings-btn').click();
  await page.getByRole('button', { name: 'Change the key for Fill bucket' }).click();
  await page.keyboard.press('KeyH');
  await page.getByRole('button', { name: 'Done' }).click();
  await openSample('UV sphere');
  await shot('16-sphere');
  await page.keyboard.press('KeyH');
  check('remapped keys work', await page.evaluate(() => window.splotch3d.engine.tool.kind === 'fill'));
  await goHome();
  await page.locator('#settings-btn').click();
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Theme -----------------------------------------------------------------------------------------------
  await page.locator('#theme-toggle').click();
  await page.waitForTimeout(100);
  await shot('17-theme');

  // Mobile layout ---------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 420, height: 780 });
  await page.waitForTimeout(150);
  await page.locator('.project-open').first().click();
  await page.waitForSelector('#workspace:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])'));
  await page.waitForTimeout(300);
  await shot('18-mobile');
  await page.locator('#panel-toggle').click();
  await page.waitForTimeout(250);
  await shot('19-mobile-panel');
  check('the panel opens as a sheet on phones', await page.evaluate(() => document.getElementById('panel').classList.contains('open')));
  await page.locator('#panel-toggle').click({ force: true });
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.waitForTimeout(200);

  // Harder imports ------------------------------------------------------------------------------------
  // A .gltf with an external buffer: two materials on one mesh, stacked on the same UVs. An unwrap has
  // to merge them onto one atlas, keeping each material's own color.
  await goHomeIfNeeded();
  const quadPositions = new Float32Array([
    -1, -1, 0, 0, -1, 0, 0, 1, 0, -1, 1, 0,
    0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0,
  ]);
  const quadNormals = new Float32Array(24);
  for (let i = 2; i < 24; i += 3) quadNormals[i] = 1;
  const quadUvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0]);
  const quadIndex = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const bin = Buffer.concat([quadPositions, quadNormals, quadUvs, quadIndex].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
  const gltf = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
      { pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1] } },
    ],
    meshes: [{
      primitives: [
        { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
        { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 4, material: 1 },
      ],
    }],
    buffers: [{ uri: 'quads.bin', byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96 },
      { buffer: 0, byteOffset: 96, byteLength: 96 },
      { buffer: 0, byteOffset: 192, byteLength: 64 },
      { buffer: 0, byteOffset: 256, byteLength: 12 },
      { buffer: 0, byteOffset: 268, byteLength: 12 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 8, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: 4, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
  };
  await page.setInputFiles('input[type="file"]', [
    { name: 'quads.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify(gltf)) },
    { name: 'quads.bin', mimeType: 'application/octet-stream', buffer: bin },
  ]);
  await page.waitForSelector('dialog[open]', { timeout: 60000 });
  check('.gltf with an external .bin loads, and its stacked materials are flagged', await page.getByText('Unwrap this model?').isVisible());
  await page.getByRole('button', { name: 'Unwrap now' }).click();
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])') && !document.querySelector('dialog[open]') && window.splotch3d.engine.project?.pristine === false, undefined, { timeout: 120000 });
  await page.waitForTimeout(300);
  const colors = await page.evaluate(() => {
    const { passes } = window.splotch3d.engine;
    const data = passes.readPass('lit');
    let red = 0;
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 2] < 60) red++;
      if (data[i + 2] > 200 && data[i] < 60) blue++;
    }
    return { red, blue };
  });
  check('unwrapping merges two materials onto one atlas', colors.red > 1000 && colors.blue > 1000, `${colors.red} red, ${colors.blue} blue texels`);
  await shot('20-multi-material');
  await goHome();

  // OBJ with no UVs at all: nothing to paint on until it's been unwrapped, so that's automatic.
  const obj = `o tetra
v 0 1 0
v -1 -1 1
v 1 -1 1
v 0 -1 -1
f 1 2 3
f 1 3 4
f 1 4 2
f 2 4 3
`;
  await page.setInputFiles('input[type="file"]', { name: 'tetra.obj', mimeType: 'text/plain', buffer: Buffer.from(obj) });
  await page.waitForSelector('#workspace:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])') && (() => {
    const uv = window.splotch3d.engine.project?.geometry.attributes.uv.array;
    return uv && uv.some((v) => v !== 0);
  })(), { timeout: 120000 });
  check('an OBJ with no UVs gets unwrapped automatically', true);
  await shot('21-obj');
  await goHome();

  // A mesh over 65k vertices: the unwrapper's 16-bit limit has to be split around.
  const { writeGlb } = await import('../js/io/glb.js');
  const grid = 270;
  const count = (grid + 1) ** 2;
  const gridPos = new Float32Array(count * 3);
  const gridNor = new Float32Array(count * 3);
  const gridUv = new Float32Array(count * 2);
  for (let y = 0; y <= grid; y++) {
    for (let x = 0; x <= grid; x++) {
      const i = y * (grid + 1) + x;
      const u = x / grid;
      const v = y / grid;
      gridPos.set([u * 2 - 1, Math.sin(u * 6) * 0.2, v * 2 - 1], i * 3);
      gridNor.set([0, 1, 0], i * 3);
      gridUv.set([u, v], i * 2);
    }
  }
  const gridIndex = new Uint32Array(grid * grid * 6);
  let at = 0;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const a = y * (grid + 1) + x;
      const b = a + grid + 1;
      gridIndex.set([a, b, a + 1, a + 1, b, b + 1], at);
      at += 6;
    }
  }
  const bigGlb = writeGlb({
    name: 'big', position: gridPos, normal: gridNor, uv: gridUv, index: gridIndex,
  });
  await page.setInputFiles('input[type="file"]', { name: 'big.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(bigGlb) });
  await page.waitForSelector('#workspace:not([hidden])', { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('#busy:not([hidden])') && window.splotch3d.engine.project?.name === 'big', undefined, { timeout: 120000 });
  check('a 73k-vertex model imports with its UVs', count > 65535 && await page.evaluate(() => !document.querySelector('dialog[open]')), `${count} vertices`);
  const bigResult = await page.evaluate(async () => {
    const { unwrapGeometry } = await import('./js/mesh/unwrap.js');
    const { analyzeUvs } = await import('./js/mesh/uvs.js');
    const g = window.splotch3d.engine.project.geometry;
    const output = await unwrapGeometry(g, { res: 2048, padding: 4 });
    const uv = output.attributes.uv.array;
    let bad = 0;
    for (const value of uv) if (!(value >= 0 && value <= 1)) bad++;
    const index = output.index.array;
    let badIndex = 0;
    for (const value of index) if (value >= output.attributes.position.count) badIndex++;
    return {
      triangles: output.index.count / 3, badUv: bad, badIndex, verts: output.attributes.position.count, usable: analyzeUvs(index, uv).usable,
    };
  });
  check('unwrapping past the 16-bit limit keeps all triangles', bigResult.triangles === grid * grid * 2 && bigResult.badIndex === 0 && bigResult.badUv === 0, JSON.stringify(bigResult));
  check('a chunked unwrap has no overlap', bigResult.usable);
  await goHome();

  // Pen and touch --------------------------------------------------------------------------------------
  await openSample('Cube with hard seams');
  await page.keyboard.press('KeyP');
  const pointerEvent = (type, pointerId, pointerType, x, y, extra = {}) => page.evaluate(([t, id, kind, px, py, more]) => {
    const canvas = document.getElementById('gl');
    const b = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: id, pointerType: kind, clientX: b.left + px, clientY: b.top + py, ...more,
    }));
  }, [type, pointerId, pointerType, x, y, extra]);
  const center = await viewportBox();
  const mx = center.width / 2;
  const my = center.height / 2;

  // The eraser end of a pen erases from any tool, and comes back to the same tool afterward.
  await page.keyboard.press('Tab');
  await settle();
  await setColor('#ff00ff');
  await page.evaluate(() => { window.splotch3d.engine.tool.perBrush.pen.size = 40; });
  await drag([[mx - 100, my], [mx + 100, my]]);
  const painted2 = await page.evaluate(([x, y]) => {
    const { uv, passes } = window.splotch3d.engine;
    const [a, b] = uv.toUv(x, y);
    return [...passes.readTexel('lit', Math.floor(a * passes.res), Math.floor(b * passes.res))];
  }, [mx, my]);
  check('painted before testing the pen eraser', painted2[0] === 255 && painted2[1] === 0, String(painted2));
  await pointerEvent('pointerdown', 9, 'pen', mx - 100, my, { button: 5, buttons: 32, pressure: 0.8 });
  for (let i = 1; i <= 10; i++) await pointerEvent('pointermove', 9, 'pen', mx - 100 + i * 20, my, { button: -1, buttons: 32, pressure: 0.8 });
  await pointerEvent('pointerup', 9, 'pen', mx + 100, my, { button: 5, buttons: 0, pressure: 0 });
  await settle();
  const erased2 = await page.evaluate(([x, y]) => {
    const { uv, passes } = window.splotch3d.engine;
    const [a, b] = uv.toUv(x, y);
    return [...passes.readTexel('lit', Math.floor(a * passes.res), Math.floor(b * passes.res))];
  }, [mx, my]);
  check('the pen\'s eraser end erases', erased2[3] < 128, String(erased2));
  check('the eraser end leaves the tool alone', await page.evaluate(() => window.splotch3d.engine.tool.kind === 'brush'));
  await page.keyboard.press('Control+z');
  await settle();
  await page.keyboard.press('Control+z');
  await settle();

  // Palm rejection: touch just after the pen was seen must not paint.
  await snapshot('lit', 'palm');
  await pointerEvent('pointermove', 9, 'pen', mx, my, { button: -1, buttons: 0 });
  await pointerEvent('pointerdown', 20, 'touch', mx, my, { button: 0, buttons: 1 });
  await pointerEvent('pointermove', 20, 'touch', mx + 80, my, { button: -1, buttons: 1 });
  await pointerEvent('pointerup', 20, 'touch', mx + 80, my, { button: 0, buttons: 0 });
  await settle();
  check('a palm right after the pen does not paint', (await countDifferent('lit', 'palm')) === 0);
  await page.waitForTimeout(1600);

  // One finger paints.
  await pointerEvent('pointerdown', 21, 'touch', mx - 60, my, { button: 0, buttons: 1 });
  await pointerEvent('pointermove', 21, 'touch', mx, my, { button: -1, buttons: 1 });
  await pointerEvent('pointermove', 21, 'touch', mx + 60, my, { button: -1, buttons: 1 });
  await pointerEvent('pointerup', 21, 'touch', mx + 60, my, { button: 0, buttons: 0 });
  await settle();
  check('one finger paints', (await countDifferent('lit', 'palm')) > 100);
  await page.keyboard.press('Control+z');
  await settle();

  // Back to 3D for the camera gestures.
  await page.keyboard.press('Tab');
  await settle();
  const touchCam = () => page.evaluate(() => {
    const { rig } = window.splotch3d.engine;
    return { yaw: rig.yaw, p: rig.position.toArray() };
  });

  // Two fingers: a second finger cancels the stroke the first one began, then orbits and zooms.
  await snapshot('lit', 'twoFingers');
  const t0 = await touchCam();
  await pointerEvent('pointerdown', 31, 'touch', mx - 60, my, { button: 0, buttons: 1 });
  await pointerEvent('pointerdown', 32, 'touch', mx + 60, my, { button: 0, buttons: 1 });
  for (let i = 1; i <= 5; i++) {
    await pointerEvent('pointermove', 31, 'touch', mx - 60 + i * 12, my, { button: -1, buttons: 1 });
    await pointerEvent('pointermove', 32, 'touch', mx + 60 + i * 12, my, { button: -1, buttons: 1 });
  }
  const t1 = await touchCam();
  check('two fingers orbit', t1.yaw !== t0.yaw);
  await pointerEvent('pointerup', 31, 'touch', mx, my, { button: 0, buttons: 0 });
  await pointerEvent('pointerup', 32, 'touch', mx + 120, my, { button: 0, buttons: 0 });
  await settle();
  check('a two-finger gesture leaves no paint behind', (await countDifferent('lit', 'twoFingers')) === 0);

  // Pinch
  const distanceOf = (state) => Math.hypot(...state.p);
  const t2 = await touchCam();
  await pointerEvent('pointerdown', 41, 'touch', mx - 30, my, { button: 0, buttons: 1 });
  await pointerEvent('pointerdown', 42, 'touch', mx + 30, my, { button: 0, buttons: 1 });
  for (let i = 1; i <= 5; i++) {
    await pointerEvent('pointermove', 41, 'touch', mx - 30 - i * 15, my, { button: -1, buttons: 1 });
    await pointerEvent('pointermove', 42, 'touch', mx + 30 + i * 15, my, { button: -1, buttons: 1 });
  }
  await pointerEvent('pointerup', 41, 'touch', mx, my, { button: 0, buttons: 0 });
  await pointerEvent('pointerup', 42, 'touch', mx, my, { button: 0, buttons: 0 });
  const t3 = await touchCam();
  check('pinching zooms in', distanceOf(t3) < distanceOf(t2), `${distanceOf(t2).toFixed(2)} -> ${distanceOf(t3).toFixed(2)}`);

  // Three fingers pan.
  await page.keyboard.press('KeyF');
  await settle();
  const t4 = await touchCam();
  for (const [id, x] of [[51, mx - 50], [52, mx], [53, mx + 50]]) await pointerEvent('pointerdown', id, 'touch', x, my, { button: 0, buttons: 1 });
  for (let i = 1; i <= 4; i++) {
    for (const [id, x] of [[51, mx - 50], [52, mx], [53, mx + 50]]) await pointerEvent('pointermove', id, 'touch', x + i * 15, my, { button: -1, buttons: 1 });
  }
  for (const id of [51, 52, 53]) await pointerEvent('pointerup', id, 'touch', mx, my, { button: 0, buttons: 0 });
  const t5 = await touchCam();
  check('three fingers pan without orbiting', t5.yaw === t4.yaw && t5.p[0] !== t4.p[0]);
  await page.keyboard.press('KeyF');
  await settle();

  // Previews and eyedropper details --------------------------------------------------------------------
  // Auto shows the pass being painted while the brush is down.
  await page.selectOption('#preview-select', 'auto');
  await setColor('#00ff00');
  await page.keyboard.press('Digit2');
  await page.mouse.move(center.x + mx, center.y + my);
  await page.mouse.down();
  await page.mouse.move(center.x + mx + 40, center.y + my, { steps: 3 });
  await page.waitForTimeout(150);
  const autoDown = await page.evaluate(() => window.splotch3d.engine.material.uniforms.uPreview.value);
  await page.mouse.up();
  await settle();
  const autoUp = await page.evaluate(() => window.splotch3d.engine.material.uniforms.uPreview.value);
  check('Auto shows the painted pass while drawing and Toon when idle', autoDown === 2 && autoUp === 0, `${autoDown}, ${autoUp}`);
  await page.selectOption('#preview-select', 'toon');
  await page.keyboard.press('Control+z');
  await settle();
  await page.keyboard.press('Digit1');

  // The final-pixel eyedropper reads the lit screen color, not the texture under it.
  await page.evaluate(() => {
    const { engine } = window.splotch3d;
    engine.project.light.azimuth = 180; // turn the light away, so this face shows its shadow pass
    engine.project.light.elevation = 0;
    engine.syncLight();
  });
  await settle();
  const pickAt = { kind: '3d', x: mx, y: my };
  const eyeTexel = await page.evaluate((v) => window.splotch3d.engine.sampleColor({ ...v, rect: window.splotch3d.engine.rect3d() }, 'texel'), pickAt);
  const eyeFinal = await page.evaluate((v) => window.splotch3d.engine.sampleColor({ ...v, rect: window.splotch3d.engine.rect3d() }, 'final'), pickAt);
  check('the two eyedropper sources differ when the surface is in shadow', eyeTexel !== eyeFinal, `${eyeTexel} vs ${eyeFinal}`);

  // Toon math on screen: fully lit shows Lit, and fully shadowed shows Shadow, exactly.
  const onScreen = await page.evaluate((v) => {
    const { engine } = window.splotch3d;
    const rect = engine.rect3d();
    const { passes } = engine;
    const hit = engine.pick(v.x, v.y);
    const x = Math.floor((hit.uv.x % 1) * passes.res);
    const y = Math.floor((hit.uv.y % 1) * passes.res);
    const hex = (b) => `#${[...b].slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    const lit = hex(passes.readTexel('lit', x, y));
    const shadow = hex(passes.readTexel('shadow', x, y));
    const n = hit.face.normal;
    // Aim the light straight along the face normal, then straight away from it.
    const az = Math.atan2(n.x, n.z) * 180 / Math.PI;
    const el = Math.asin(n.y) * 180 / Math.PI;
    engine.project.light.azimuth = az;
    engine.project.light.elevation = el;
    engine.syncLight();
    const whenLit = engine.sampleColor({ ...v, rect }, 'final');
    engine.project.light.azimuth = az + 180;
    engine.project.light.elevation = -el;
    engine.syncLight();
    const whenDark = engine.sampleColor({ ...v, rect }, 'final');
    return {
      lit, shadow, whenLit, whenDark,
    };
  }, pickAt);
  const closeHex = (a, b) => {
    const value = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return [0, 1, 2].every((i) => Math.abs(value(a, i) - value(b, i)) <= 2);
  };
  check('what you paint is what you get: lit side shows the Lit pass', closeHex(onScreen.whenLit, onScreen.lit), `${onScreen.whenLit} vs ${onScreen.lit}`);
  check('what you paint is what you get: dark side shows the Shadow pass', closeHex(onScreen.whenDark, onScreen.shadow), `${onScreen.whenDark} vs ${onScreen.shadow}`);

  // Painting in 3D matches the color asked for, with no color-space shift on the way through.
  await page.keyboard.press('KeyP');
  await setColor('#3a7fd5');
  await page.evaluate(() => { window.splotch3d.engine.tool.perBrush.pen.size = 50; });
  await drag([[mx - 30, my], [mx + 30, my]]);
  const exact = await page.evaluate((v) => {
    const { engine } = window.splotch3d;
    return engine.sampleColor({ ...v, rect: engine.rect3d() }, 'texel');
  }, pickAt);
  check('sRGB stays exact through the paint pipeline', exact === '#3a7fd5', exact);

  // Unit tests -------------------------------------------------------------------------------------------
  const unit = await context.newPage();
  await unit.goto(new URL('tests/index.html', BASE).href);
  await unit.waitForFunction(() => window.testResults, undefined, { timeout: 30000 });
  const unitResults = await unit.evaluate(() => ({
    ...window.testResults,
    failures: [...document.querySelectorAll('.fail')].map((n) => n.textContent),
  }));
  check('unit tests pass', unitResults.failed === 0, `${unitResults.total - unitResults.failed}/${unitResults.total} ${unitResults.failures.join(' | ')}`);
  await unit.close();

  // Splotchle has to be untouched by the shared code.
  const splotchle = await context.newPage();
  const splotchleProblems = [];
  splotchle.on('pageerror', (e) => splotchleProblems.push(e.message));
  await splotchle.goto(new URL('../splotchle/', BASE).href);
  await splotchle.waitForSelector('#draw-canvas');
  await splotchle.waitForTimeout(600);
  await splotchle.keyboard.press('Escape');
  const stage = await splotchle.locator('#draw-canvas').boundingBox();
  await splotchle.mouse.move(stage.x + 200, stage.y + 200);
  await splotchle.mouse.down();
  await splotchle.mouse.move(stage.x + 320, stage.y + 260, { steps: 8 });
  await splotchle.mouse.up();
  await splotchle.waitForTimeout(200);
  const drewOk = await splotchle.evaluate(() => {
    const canvas = document.getElementById('draw-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
  check('Splotchle still draws after its small export change', drewOk > 100 && splotchleProblems.length === 0, `${drewOk} pixels; ${splotchleProblems.join(' ')}`);
  await splotchle.goto(new URL('../splotchle/tests/index.html', BASE).href);
  await splotchle.waitForTimeout(1500);
  const splotchleFailed = await splotchle.locator('.fail').count().catch(() => 0);
  check('Splotchle\'s own tests still pass', splotchleFailed === 0, `${splotchleFailed} failures`);
  await splotchle.close();
} catch (error) {
  check(`unexpected failure: ${error.message}`, false);
  await shot('error');
}

check('no console errors', problems.length === 0, problems.slice(0, 5).join(' | ').slice(0, 800));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (process.env.E2E_REPORT) writeFileSync(process.env.E2E_REPORT, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
