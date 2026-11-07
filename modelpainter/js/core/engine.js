// The painter's heart: owns the renderer and the open project's GPU state, renders the views, and
// offers every painting and picking action to the UI and input layers.

import * as THREE from 'three';
import { CameraRig } from '../view/camera.js';
import { UvView } from '../view/uvview.js';
import { History } from '../paint/history.js';
import { PassStore, PASSES } from '../paint/passes.js';
import { Projector } from '../paint/projector.js';
import { Painter } from '../paint/painter.js';
import { BRUSHES } from '../paint/brush.js';
import {
  IslandMap, applyFlood, blendTexel, clippedFlood, hexToBytes,
} from '../paint/fills.js';
import { computeIslands } from '../mesh/uvs.js';
import { prepareGeometry } from '../mesh/import.js';
import { toonFragment, toonVertex } from '../shaders/toon.glsl.js';
import { settings } from './settings.js';

// All color math is done by hand in the shaders, on raw sRGB bytes.
THREE.ColorManagement.enabled = false;

export const PREVIEWS = ['toon', 'lit', 'shadow', 'auto'];
export const PREVIEW_NAMES = {
  toon: 'Toon', lit: 'Lit only', shadow: 'Shadow only', auto: 'Auto',
};

export const DEFAULT_SHADER = {
  threshold: 0.5, softness: 0.04, edgeStrength: 0.35, rimColor: [0.6, 1.0, 0.85], rimPower: 3.0, rimStrength: 0,
};

const ndc = new THREE.Vector2();
const worldUp = new THREE.Vector3(0, 1, 0);
const scratch = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Engine {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', alpha: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.autoClear = false;
    this.background = new THREE.Color(0x2b2d33);

    this.rig = new CameraRig();
    this.uv = new UvView();
    this.projector = new Projector(this.renderer);
    this.islandMap = new IslandMap(this.renderer);
    this.history = new History();
    this.history.onChange = () => this.emit('history');

    this.listeners = new Map();
    this.width = 1;
    this.height = 1;
    this.viewMode = '3d';
    this.pass = 'lit';
    this.preview = 'toon';
    this.lightAuto = false;
    this.needsRender = true;
    this.frameHooks = [];
    /** @type {object|null} the open project */
    this.project = null;
    /** @type {PassStore|null} */
    this.passes = null;
    /** @type {Painter|null} */
    this.painter = null;

    this.tool = {
      kind: 'brush', // brush, eraser, fill or eyedropper
      brush: 'paint',
      color: '#c7402d',
      fillMode: 'island', // island, connected or whole
      tolerance: 32,
      // Each brush remembers its own size, opacity and spacing.
      perBrush: Object.fromEntries(BRUSHES.map((b) => [b.id, { size: b.size, opacity: b.opacity, spacing: b.spacing }])),
      // The eraser keeps its own settings, and borrows the shape of any brush as its tip.
      eraser: {
        tip: 'pen', size: 40, opacity: 1, spacing: 0.02,
      },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: toonVertex,
      fragmentShader: toonFragment,
      uniforms: {
        uLit: { value: null },
        uShadow: { value: null },
        uEdge: { value: null },
        uThreshold: { value: DEFAULT_SHADER.threshold },
        uSoftness: { value: DEFAULT_SHADER.softness },
        uEdgeStrength: { value: DEFAULT_SHADER.edgeStrength },
        uRimColor: { value: new THREE.Vector3(...DEFAULT_SHADER.rimColor) },
        uRimPower: { value: DEFAULT_SHADER.rimPower },
        uRimStrength: { value: DEFAULT_SHADER.rimStrength },
        uLightDir: { value: new THREE.Vector3(0.5, 0.7, 0.5).normalize() },
        uLightColor: { value: new THREE.Vector3(1, 1, 1) },
        uPreview: { value: 0 },
        uUnpainted: { value: new THREE.Vector3(0.75, 0.75, 0.75) },
      },
    });
    this.scene = new THREE.Scene();
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.#buildOverlays();

    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  // Events --------------------------------------------------------------------------------------

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }

  emit(name, detail) {
    for (const fn of this.listeners.get(name) ?? []) fn(detail);
  }

  // Scene helpers -------------------------------------------------------------------------------

  #buildOverlays() {
    const overlay = (color, inner, outer) => new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 64),
      new THREE.MeshBasicMaterial({
        color, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9,
      }),
    );
    // Two tones, so the ring reads against light and dark paint alike.
    this.ring = new THREE.Group();
    this.ring.add(overlay(0xffffff, 0.965, 1), overlay(0x111111, 1, 1.035));
    this.ring.visible = false;
    this.ring.renderOrder = 10;
    for (const child of this.ring.children) child.renderOrder = 10;
    this.scene.add(this.ring);

    this.pivotDot = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true }),
    );
    this.pivotDot.renderOrder = 11;
    this.pivotDot.visible = false;
    this.scene.add(this.pivotDot);

    this.lightMarker = new THREE.Group();
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd76a, depthTest: false, depthWrite: false, transparent: true }),
    );
    sun.renderOrder = 12;
    this.lightMarkerSun = sun;
    const beam = new THREE.BufferGeometry();
    beam.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.lightBeam = new THREE.Line(beam, new THREE.LineBasicMaterial({
      color: 0xffd76a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.7,
    }));
    this.lightBeam.frustumCulled = false;
    this.lightBeam.renderOrder = 12;
    this.lightMarker.add(sun, this.lightBeam);
    this.lightMarker.visible = false;
    this.scene.add(this.lightMarker);
  }

  /** How large one CSS pixel is in world units at a point. */
  worldPerPixel(point) {
    const { camera } = this.rig;
    const forward = scratch.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const depth = Math.max(lookTarget.copy(point).sub(camera.position).dot(forward), camera.near);
    return (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / this.rect3d().height;
  }

  // View layout ---------------------------------------------------------------------------------

  resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
    }
    this.#layoutViews();
    this.requestRender();
  }

  #layoutViews() {
    const r3 = this.rect3d();
    const ruv = this.rectUv();
    if (r3) this.rig.setAspect(r3.width / r3.height);
    if (ruv) this.uv.resize(ruv.width, ruv.height);
  }

  /** The 3D view's area in CSS pixels, or null when it isn't showing. */
  rect3d() {
    if (this.viewMode === 'uv') return null;
    const width = this.viewMode === 'split' ? Math.floor(this.width / 2) : this.width;
    return {
      x: 0, y: 0, width, height: this.height,
    };
  }

  /** The UV view's area in CSS pixels, or null when it isn't showing. */
  rectUv() {
    if (this.viewMode === '3d') return null;
    const x = this.viewMode === 'split' ? Math.floor(this.width / 2) : 0;
    return {
      x, y: 0, width: this.width - x, height: this.height,
    };
  }

  /** @returns {{ kind: '3d'|'uv', x: number, y: number, rect: object }|null} */
  viewAt(clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    const px = clientX - bounds.left;
    const py = clientY - bounds.top;
    const r3 = this.rect3d();
    if (r3 && px >= r3.x && px < r3.x + r3.width) {
      return {
        kind: '3d', x: px - r3.x, y: py - r3.y, rect: r3,
      };
    }
    const ruv = this.rectUv();
    if (ruv && px >= ruv.x && px < ruv.x + ruv.width) {
      return {
        kind: 'uv', x: px - ruv.x, y: py - ruv.y, rect: ruv,
      };
    }
    return null;
  }

  setViewMode(mode) {
    if (this.viewMode === mode) return;
    const hadUv = this.rectUv() !== null;
    this.viewMode = mode;
    this.#layoutViews();
    if (!hadUv && this.rectUv()) this.uv.fit();
    this.hideCursor();
    this.requestRender();
    this.emit('view');
  }

  /** Fits whatever view is under a point, or all of them. */
  frame(kind = null) {
    if (!this.project) return;
    if (kind !== 'uv' && this.rect3d()) this.rig.frame(this.project.geometry.boundingSphere, true);
    if (kind !== '3d' && this.rectUv()) this.uv.fit();
    this.requestRender();
  }

  // Render loop ---------------------------------------------------------------------------------

  requestRender() {
    this.needsRender = true;
  }

  loop(time) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;
    for (const hook of this.frameHooks) hook(dt);
    if (this.project) {
      if (this.lightAuto) {
        this.project.light.azimuth = (this.project.light.azimuth + dt * 20) % 360;
        this.syncLight();
      }
      if (this.painter.frame()) this.needsRender = true;
    }
    if (this.needsRender) this.render();
  }

  render() {
    this.needsRender = false;
    const { renderer } = this;
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setClearColor(this.background, 1);
    renderer.setViewport(0, 0, this.width, this.height);
    renderer.clear(true, true, false);
    if (!this.project) return;

    const preview = this.painter.previewPass;
    const u = this.material.uniforms;
    u.uLit.value = this.passes.textureFor('lit', preview);
    u.uShadow.value = this.passes.textureFor('shadow', preview);
    u.uEdge.value = this.passes.textureFor('edge', preview);
    u.uPreview.value = this.#previewMode();

    renderer.setScissorTest(true);
    const r3 = this.rect3d();
    if (r3) {
      renderer.setViewport(r3.x, this.height - r3.y - r3.height, r3.width, r3.height);
      renderer.setScissor(r3.x, this.height - r3.y - r3.height, r3.width, r3.height);
      renderer.render(this.scene, this.rig.camera);
    }
    const ruv = this.rectUv();
    if (ruv) {
      renderer.setViewport(ruv.x, this.height - ruv.y - ruv.height, ruv.width, ruv.height);
      renderer.setScissor(ruv.x, this.height - ruv.y - ruv.height, ruv.width, ruv.height);
      this.uv.render(renderer, this.passes.textureFor(this.pass, preview), this.pass === 'edge');
    }
    renderer.setScissorTest(false);
  }

  #previewMode() {
    const flat = { lit: 1, shadow: 2, edge: 3 };
    if (this.preview === 'lit') return 1;
    if (this.preview === 'shadow') return 2;
    if (this.preview === 'auto' && this.painter.painting) return flat[this.pass];
    return 0;
  }

  // Project -------------------------------------------------------------------------------------

  /**
   * Makes a project current and readies its GPU state. Passes start out holding placeholders, ready
   * for the caller to bake or load into.
   * @param {object} project
   */
  attach(project) {
    this.detach();
    this.project = project;
    this.history.clear();
    this.passes = new PassStore(this.renderer, project.res, this.history);
    this.passes.dilationSetting = settings.dilation;
    this.passes.onChange = (pass) => {
      this.requestRender();
      this.emit('painted', pass);
    };
    this.painter = new Painter({ passes: this.passes, projector: this.projector });
    this.setGeometry(project.geometry);
    this.rig.frame(project.geometry.boundingSphere);
    this.syncShader();
    this.syncLight();
    this.uv.fit();
    this.requestRender();
  }

  detach() {
    if (!this.project) return;
    this.painter.cancel();
    this.passes.dispose();
    this.passes = null;
    this.painter = null;
    this.project = null;
    this.lightAuto = false;
    this.history.clear();
    this.islandMap.invalidate();
    this.hideCursor();
    this.requestRender();
  }

  /**
   * Swaps in a geometry: display, ray-casting tree, wireframe, islands and layout masks.
   * @param {THREE.BufferGeometry} geometry
   */
  setGeometry(geometry) {
    prepareGeometry(geometry);
    this.project.geometry = geometry;
    this.mesh.geometry = geometry;
    this.material.side = this.project.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    this.material.needsUpdate = true;
    this.projector.setGeometry(geometry);
    this.uv.setGeometry(geometry);
    this.islands = computeIslands(geometry.index.array, geometry.attributes.uv.array);
    this.islandMap.invalidate();
    this.passes.buildLayout(geometry);
    this.requestRender();
  }

  /** Copies shader settings from the project to the material. */
  syncShader() {
    const s = this.project.shader;
    const u = this.material.uniforms;
    u.uThreshold.value = s.threshold;
    u.uSoftness.value = s.softness;
    u.uEdgeStrength.value = s.edgeStrength;
    u.uRimColor.value.set(s.rimColor[0], s.rimColor[1], s.rimColor[2]);
    u.uRimPower.value = s.rimPower;
    u.uRimStrength.value = s.rimStrength;
    this.requestRender();
  }

  /** Copies the preview light from the project to the material. */
  syncLight() {
    const { azimuth, elevation } = this.project.light;
    const a = THREE.MathUtils.degToRad(azimuth);
    const e = THREE.MathUtils.degToRad(elevation);
    this.material.uniforms.uLightDir.value.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    this.#updateLightMarker();
    this.requestRender();
  }

  // Passes and modes ----------------------------------------------------------------------------

  setPass(pass) {
    if (!PASSES.includes(pass) || this.pass === pass) return;
    if (this.painter?.painting) return;
    this.pass = pass;
    this.requestRender();
    this.emit('pass');
  }

  cyclePreview() {
    this.setPreview(PREVIEWS[(PREVIEWS.indexOf(this.preview) + 1) % PREVIEWS.length]);
  }

  setPreview(preview) {
    this.preview = preview;
    this.requestRender();
    this.emit('preview');
  }

  /** Orbits the preview light by a pixel drag. */
  dragLight(dx, dy) {
    const { light } = this.project;
    light.azimuth = (light.azimuth + dx * 0.6 + 360) % 360;
    light.elevation = clamp(light.elevation - dy * 0.6, -89, 89);
    this.syncLight();
    this.emit('light');
  }

  showLightMarker(visible) {
    this.lightMarker.visible = visible;
    this.#updateLightMarker();
    this.requestRender();
  }

  #updateLightMarker() {
    if (!this.project || !this.lightMarker.visible) return;
    const sphere = this.project.geometry.boundingSphere;
    const position = scratch.copy(this.material.uniforms.uLightDir.value).multiplyScalar(sphere.radius * 1.5).add(sphere.center);
    this.lightMarkerSun.position.copy(position);
    this.lightMarkerSun.scale.setScalar(sphere.radius * 0.035);
    const line = this.lightBeam.geometry.attributes.position;
    line.setXYZ(0, position.x, position.y, position.z);
    line.setXYZ(1, sphere.center.x, sphere.center.y, sphere.center.z);
    line.needsUpdate = true;
  }

  // Picking -------------------------------------------------------------------------------------

  /**
   * Finds the surface under a point in the 3D view.
   * @returns {THREE.Intersection|null}
   */
  pick(x, y) {
    if (!this.project) return null;
    const r3 = this.rect3d();
    if (!r3) return null;
    ndc.set((x / r3.width) * 2 - 1, -(y / r3.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    // Rays must see both faces in double-sided projects, and the material decides that.
    const hits = this.raycaster.intersectObject(this.mesh, false);
    return hits[0] ?? null;
  }

  /** Where a cursor ray hits, or a point at the pivot's depth when it hits nothing. */
  zoomTarget(x, y, out) {
    const hit = this.pick(x, y);
    if (hit) return out.copy(hit.point);
    return this.rig.pointAtPivotDepth(this.raycaster.ray, out);
  }

  /** The settings for whichever tool is active: the eraser's own, or the current brush's. */
  get brushSettings() {
    return this.tool.kind === 'eraser' ? this.tool.eraser : this.tool.perBrush[this.tool.brush];
  }

  /** Current brush diameter in CSS pixels at a point on the model. */
  brushPixels(point = null) {
    return this.#sizeToPixels(this.brushSettings.size, point);
  }

  /** In world-size mode, the size slider means a share of the model, so it depends on distance. */
  #sizeToPixels(size, point) {
    if (!settings.worldSizeBrush || !point || !this.project) return size;
    const world = (size / 500) * this.project.geometry.boundingSphere.radius * 2;
    return world / this.worldPerPixel(point);
  }

  // Cursor --------------------------------------------------------------------------------------

  /**
   * Places the brush ring on the surface, lying flat against the normal.
   * @returns {boolean} whether the ring is showing
   */
  placeCursor(x, y) {
    if (this.tool.kind === 'eyedropper' || this.tool.kind === 'fill') {
      this.hideCursor();
      return false;
    }
    const hit = this.pick(x, y);
    if (!hit) {
      this.hideCursor();
      return false;
    }
    const radius = (this.brushPixels(hit.point) / 2) * this.worldPerPixel(hit.point);
    this.ring.visible = true;
    this.ring.position.copy(hit.point);
    this.ring.scale.setScalar(radius);
    lookTarget.copy(hit.point).add(hit.face.normal);
    this.ring.up.copy(worldUp);
    if (Math.abs(hit.face.normal.dot(worldUp)) > 0.99) this.ring.up.set(1, 0, 0);
    this.ring.lookAt(lookTarget);
    this.requestRender();
    return true;
  }

  hideCursor() {
    if (!this.ring.visible) return;
    this.ring.visible = false;
    this.requestRender();
  }

  /** Shows or hides the dot marking the orbit pivot. */
  showPivot(visible) {
    this.pivotDot.visible = visible;
    if (visible) {
      this.pivotDot.position.copy(this.rig.pivot);
      this.pivotDot.scale.setScalar(this.worldPerPixel(this.rig.pivot) * 4);
    }
    this.requestRender();
  }

  // Painting ------------------------------------------------------------------------------------

  /**
   * Starts a stroke.
   * @param {{ kind: '3d'|'uv', x: number, y: number }} view
   * @param {number} pressure
   * @param {{ pen: boolean, erase?: boolean }} options
   */
  strokeBegin(view, pressure, { pen, erase = this.tool.kind === 'eraser' }) {
    if (!this.project || this.painter.painting) return;
    // A pen's eraser end works from any tool, so this can't rely on the active tool being the eraser.
    const brushSettings = erase ? this.tool.eraser : this.tool.perBrush[this.tool.brush];
    let { size } = brushSettings;
    if (view.kind === '3d' && settings.worldSizeBrush) {
      size = this.#sizeToPixels(size, this.pick(view.x, view.y)?.point ?? null);
    }
    const tool = {
      pass: this.pass,
      brush: erase ? this.tool.eraser.tip : this.tool.brush,
      color: erase ? '#000000' : this.tool.color,
      size,
      opacity: brushSettings.opacity,
      spacing: brushSettings.spacing,
      usePressure: pen && settings.usePressure,
      curve: settings.pressureCurve,
      erase,
    };
    if (view.kind === '3d') {
      const r3 = this.rect3d();
      this.painter.begin3d({
        camera: this.rig.camera,
        width: r3.width,
        height: r3.height,
        pixelRatio: this.pixelRatio,
        doubleSided: this.project.doubleSided,
      }, tool);
    } else {
      this.painter.beginUv(this.uv, tool);
    }
    this.painter.add(view.x, view.y, pressure);
    this.requestRender();
  }

  strokeAdd(x, y, pressure) {
    this.painter?.add(x, y, pressure);
  }

  strokeEnd() {
    if (!this.painter?.painting) return;
    const erase = this.painter.active.erase;
    const changed = this.painter.end();
    if (changed && !erase) this.emit('colorused', this.tool.color);
    this.requestRender();
  }

  strokeCancel() {
    this.painter?.cancel();
    this.requestRender();
  }

  // Sampling and filling ------------------------------------------------------------------------

  /** Turns a point in a view into a texel. */
  #texelAt(view) {
    const { res } = this.passes;
    let u;
    let v;
    let hit = null;
    if (view.kind === '3d') {
      hit = this.pick(view.x, view.y);
      if (!hit?.uv) return null;
      u = hit.uv.x;
      v = hit.uv.y;
    } else {
      [u, v] = this.uv.toUv(view.x, view.y);
      if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
    }
    u -= Math.floor(u);
    v -= Math.floor(v);
    return {
      x: Math.min(res - 1, Math.floor(u * res)), y: Math.min(res - 1, Math.floor(v * res)), hit,
    };
  }

  /**
   * The eyedropper. Reads the active pass's texel, or what's actually on screen.
   * @returns {string|null} '#rrggbb'
   */
  sampleColor(view, source = settings.eyedropSource) {
    if (!this.project) return null;
    let bytes;
    if (source === 'final') {
      this.render();
      const gl = this.renderer.getContext();
      bytes = new Uint8Array(4);
      const bounds = view.rect;
      const px = Math.round((bounds.x + view.x) * this.pixelRatio);
      const py = Math.round((this.height - (bounds.y + view.y)) * this.pixelRatio);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    } else {
      const texel = this.#texelAt(view);
      if (!texel) return null;
      bytes = this.passes.readTexel(this.pass, texel.x, texel.y);
    }
    const hex = (v) => v.toString(16).padStart(2, '0');
    return `#${hex(bytes[0])}${hex(bytes[1])}${hex(bytes[2])}`;
  }

  /** The island number (plus one) for a texel, looking at its neighbors if it just misses one. */
  #islandNear(map, x, y) {
    const { res } = this.passes;
    if (map[y * res + x]) return { x, y, id: map[y * res + x] };
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
          if (map[ny * res + nx]) return { x: nx, y: ny, id: map[ny * res + nx] };
        }
      }
    }
    return null;
  }

  /**
   * The fill bucket.
   * @param {{ kind: '3d'|'uv', x: number, y: number }} view
   * @returns {boolean} whether anything was filled
   */
  fillAt(view) {
    if (!this.project) return false;
    const { passes, pass, tool } = this;
    const { res } = passes;
    const gray = pass === 'edge';
    const rgb = hexToBytes(tool.color);
    const { opacity } = this.brushSettings;
    const pixels = passes.readPass(pass);

    if (tool.fillMode === 'whole') {
      for (let i = 0; i < pixels.length; i += 4) blendTexel(pixels, i, rgb, opacity, gray);
      const changed = passes.commitPixels(pass, pixels, 'Fill');
      if (changed) this.emit('colorused', tool.color);
      return changed;
    }

    const texel = this.#texelAt(view);
    if (!texel) return false;
    const map = this.islandMap.get(this.project.geometry, this.islands.triangleIsland, res);
    let islandId;
    let start = texel;
    if (texel.hit) {
      // In 3D the triangle under the cursor gives the island directly.
      islandId = this.islands.triangleIsland[texel.hit.faceIndex] + 1;
    } else {
      const near = this.#islandNear(map, texel.x, texel.y);
      if (!near) return false; // clicked empty space in the UV view
      islandId = near.id;
      start = near;
    }

    if (tool.fillMode === 'island') {
      for (let i = 0; i < map.length; i++) {
        if (map[i] === islandId) blendTexel(pixels, i * 4, rgb, opacity, gray);
      }
    } else {
      const near = this.#islandNear(map, start.x, start.y);
      if (!near) return false;
      const flood = clippedFlood(pixels, res, map, near.x, near.y, tool.tolerance);
      applyFlood(pixels, res, flood, rgb, opacity, gray, map, near.id);
    }
    const changed = passes.commitPixels(pass, pixels, 'Fill');
    if (changed) this.emit('colorused', tool.color);
    return changed;
  }

  // Undo ----------------------------------------------------------------------------------------

  async undo() {
    if (this.painter?.painting) return;
    await this.history.undo();
    this.requestRender();
  }

  async redo() {
    if (this.painter?.painting) return;
    await this.history.redo();
    this.requestRender();
  }

  // Thumbnails ----------------------------------------------------------------------------------

  /** @returns {Promise<Blob|null>} a small PNG of the model, in Toon with the preview light */
  async thumbnail(size = 256) {
    if (!this.project) return null;
    const { renderer } = this;
    const target = new THREE.WebGLRenderTarget(size, size, { colorSpace: THREE.NoColorSpace, samples: 4 });
    const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
    const rig = new CameraRig();
    rig.camera.aspect = 1;
    rig.frame(this.project.geometry.boundingSphere);
    camera.copy(rig.camera);
    const u = this.material.uniforms;
    u.uLit.value = this.passes.targets.lit.texture;
    u.uShadow.value = this.passes.targets.shadow.texture;
    u.uEdge.value = this.passes.targets.edge.texture;
    const previewBefore = u.uPreview.value;
    u.uPreview.value = 0;
    const visible = [this.ring.visible, this.pivotDot.visible, this.lightMarker.visible];
    this.ring.visible = false;
    this.pivotDot.visible = false;
    this.lightMarker.visible = false;

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(previous);
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    target.dispose();
    [this.ring.visible, this.pivotDot.visible, this.lightMarker.visible] = visible;
    u.uPreview.value = previewBefore;
    this.requestRender();

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const image = new ImageData(size, size);
    // WebGL rows run bottom-up, and images run top-down.
    for (let y = 0; y < size; y++) {
      image.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    }
    canvas.getContext('2d').putImageData(image, 0, 0);
    return new Promise((resolve) => { canvas.toBlob(resolve, 'image/png'); });
  }
}
