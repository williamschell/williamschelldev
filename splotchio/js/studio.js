// The Draw view: owns the current blob, the drawing layer, autosave and all the controls.

import {
  generateBlob, normalizeParams, colorForSeed, BLOB_COLORS, DEFAULT_PARAMS, PRESETS, GEN_VERSION, ARTBOARD,
} from './blob.js';
import { composeMatrix, defaultTransform, normalizeTransform, toSvgMatrix } from './transform.js';
import {
  localDateString, dailySeed, dailyParams, challengeNumber, emptyStreak, recordDaily, currentStreak, LAUNCH_DATE,
} from './daily.js';
import { DrawingLayer } from './draw.js';
import { getDraft, putDraft, putArtwork, readSetting, writeSetting } from './storage.js';
import {
  renderPanel, canvasToBlob, downloadArt, GHOST_OPACITY, OUTLINE_WIDTH,
} from './export.js';
import { encodeShareQuery, decodeShareQuery } from './share.js';
import {
  el, toast, confirmDialog, openDialog, newId, formatDate, icon,
} from './ui.js';

const SWATCHES = [
  ['#1b1a17', 'Ink'], ['#ffffff', 'White'], ['#e5352b', 'Red'], ['#ff8a1f', 'Orange'],
  ['#ffd21f', 'Yellow'], ['#1fa855', 'Green'], ['#2a6dff', 'Blue'], ['#a33ee8', 'Purple'],
];
const BLOB_COLOR_NAMES = ['Coral', 'Blue', 'Green', 'Purple', 'Pink', 'Teal', 'Amber', 'Indigo'];
const PARAM_KEYS = Object.keys(DEFAULT_PARAMS);
const THUMB_SIZE = 384;
const AUTOSAVE_MS = 1000;

const $ = (id) => document.getElementById(id);

const randomSeed = () => Math.random().toString(36).slice(2, 10);

/**
 * Gets the blob's path for a stored record. If the record came from another generator
 * version, its stored path wins, so old art keeps its original blob.
 */
function resolvePath(record) {
  if ((record.genVersion ?? GEN_VERSION) !== GEN_VERSION && record.pathData) return record.pathData;
  return generateBlob({ seed: record.seed, params: record.params }).pathData;
}

/**
 * @param {{ onPost: (payload: object) => void }} deps
 */
export function createStudio({ onPost }) {
  let active = true;
  /** The blob and metadata being worked on. */
  const state = {
    mode: 'daily', // which draft slot this is: 'daily' or 'free'
    seed: '',
    params: normalizeParams(),
    pathData: '',
    genVersion: GEN_VERSION,
    transform: defaultTransform(),
    blobStyle: { mode: 'fill', color: '#ff5a36', visible: true },
    dailyDate: null, // only set for today's real daily
    title: '',
    artworkId: null,
    createdAt: null,
    dirty: false,
    unlocked: false,
  };
  let streak = readSetting('streak', emptyStreak());

  const layer = new DrawingLayer($('draw-canvas'), {
    size: ARTBOARD,
    // More than 2x costs a lot of memory on phones and is hard to see.
    scale: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
    onChange: () => {
      state.dirty = true;
      if (!layer.hasArt) state.unlocked = false;
      syncControls();
      scheduleAutosave();
    },
  });

  // --- Rendering ---

  function renderBlob() {
    const path = $('blob-path');
    path.setAttribute('d', state.pathData);
    $('blob-group').setAttribute('transform', toSvgMatrix(composeMatrix(state.transform, ARTBOARD)));
    const { mode, color, visible } = state.blobStyle;
    const outline = mode === 'outline';
    path.setAttribute('fill', outline ? 'none' : color);
    path.setAttribute('fill-opacity', mode === 'ghost' ? GHOST_OPACITY : 1);
    path.setAttribute('stroke', outline ? color : 'none');
    path.setAttribute('stroke-width', outline ? OUTLINE_WIDTH : 0);
    $('blob-svg').style.visibility = visible ? 'visible' : 'hidden';
  }

  function sliderOutput(key, value) {
    const out = $(`out-${key}`);
    if (!out) return;
    if (key === 'rotate') out.textContent = `${Math.round(value)}°`;
    else if (['lobes', 'holes', 'protrusions'].includes(key)) out.textContent = String(value);
    else out.textContent = Number(value).toFixed(2);
  }

  function syncControls() {
    const isDaily = state.dailyDate !== null;
    const today = localDateString();

    if (isDaily) {
      $('challenge-title').textContent = `Splotch #${challengeNumber(state.dailyDate)}`;
      $('challenge-sub').textContent = `${formatDate(state.dailyDate)}. New blob at midnight.`;
    } else {
      $('challenge-title').textContent = state.title || 'Free play';
      $('challenge-sub').textContent = 'Just for fun. Free play blobs stay in your own gallery.';
    }
    const days = currentStreak(streak, today);
    $('streak').hidden = days === 0;
    $('streak').textContent = `${days} day streak`;

    $('daily-section').hidden = state.mode !== 'daily';
    $('free-section').hidden = state.mode !== 'free';
    $('generator-controls').hidden = state.mode !== 'free';

    // The blob locks once there's art on it, so the two can't drift apart by accident.
    const locked = layer.hasArt && !state.unlocked;
    $('lock-note').hidden = !locked;
    $('generator-controls').disabled = locked;
    $('transform-controls').disabled = locked;

    $('seed').value = state.seed;
    for (const key of PARAM_KEYS) {
      const input = $(`param-${key}`);
      input.value = state.params[key];
      sliderOutput(key, state.params[key]);
    }
    const presetName = Object.keys(PRESETS).find((name) => PARAM_KEYS.every(
      (key) => PRESETS[name][key] === state.params[key],
    ));
    $('preset').value = presetName ?? '';

    for (const key of ['rotate', 'scale']) {
      $(`t-${key}`).value = state.transform[key];
      sliderOutput(key, state.transform[key]);
    }

    for (const radio of document.querySelectorAll('input[name="blob-mode"]')) {
      radio.checked = radio.value === state.blobStyle.mode;
    }
    $('blob-color').value = state.blobStyle.color;
    for (const swatch of $('blob-swatches').querySelectorAll('[data-color]')) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.color === state.blobStyle.color));
    }
    $('toggle-blob').replaceChildren(icon(state.blobStyle.visible ? 'eye' : 'eye-off'));
    $('toggle-blob').setAttribute('aria-pressed', String(!state.blobStyle.visible));

    $('undo').disabled = !layer.canUndo;
    $('redo').disabled = !layer.canRedo;
    $('clear').disabled = !layer.hasArt;
    $('save').disabled = !layer.hasArt;
    $('save').textContent = state.artworkId && !state.dirty ? 'Saved' : 'Save';
    $('export').disabled = false;
    $('post').hidden = state.dailyDate !== today;
    $('post').disabled = !layer.hasArt;

    $('past-date').min = LAUNCH_DATE;
    $('past-date').max = today;
    syncTool();
  }

  function syncTool() {
    const {
      tool, color, size, pressure,
    } = layer.tool;
    $('tool-brush').setAttribute('aria-pressed', String(tool === 'brush'));
    $('tool-eraser').setAttribute('aria-pressed', String(tool === 'eraser'));
    for (const swatch of $('swatches').querySelectorAll('[data-color]')) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.color === color && tool === 'brush'));
    }
    $('custom-color').value = color;
    $('brush-size').value = size;
    const dot = $('size-dot');
    const shown = Math.max(3, Math.min(26, size / 2));
    dot.style.width = `${shown}px`;
    dot.style.height = `${shown}px`;
    dot.style.background = tool === 'eraser' ? 'transparent' : color;
    dot.classList.toggle('erasing', tool === 'eraser');
    $('pen-pressure').checked = pressure;
    writeSetting('brush', { color, size, pressure });
  }

  // --- Autosave ---

  let autosaveTimer = null;

  async function writeDraft() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    const { strokes, baseBlob } = await layer.getState();
    await putDraft(state.mode, {
      seed: state.seed,
      params: state.params,
      pathData: state.pathData,
      genVersion: state.genVersion,
      transform: state.transform,
      blobStyle: state.blobStyle,
      dailyDate: state.dailyDate,
      title: state.title,
      artworkId: state.artworkId,
      createdAt: state.createdAt,
      dirty: state.dirty,
      unlocked: state.unlocked,
      strokes,
      baseBlob,
      updatedAt: Date.now(),
    });
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(writeDraft, AUTOSAVE_MS);
  }

  /** Writes now, but only if a change is waiting, so a switch can't lose the last second of work. */
  async function flushAutosave() {
    if (autosaveTimer !== null) await writeDraft();
  }

  // --- Loading blobs ---

  function applyBlob(fields) {
    Object.assign(state, {
      genVersion: GEN_VERSION,
      transform: defaultTransform(),
      dailyDate: null,
      title: '',
      artworkId: null,
      createdAt: null,
      dirty: false,
      unlocked: false,
    }, fields);
    state.params = normalizeParams(state.params);
    state.transform = normalizeTransform(state.transform);
    state.pathData = resolvePath(state);
  }

  function setMode(mode) {
    state.mode = mode;
    writeSetting('lastMode', mode);
  }

  function freshDaily(today) {
    const seed = dailySeed(today);
    setMode('daily');
    applyBlob({
      seed,
      params: dailyParams(today),
      dailyDate: today,
      blobStyle: { mode: 'fill', color: colorForSeed(seed), visible: true },
    });
    layer.reset();
  }

  function freshFree(seed, params, title = '') {
    setMode('free');
    applyBlob({
      seed,
      params,
      title,
      blobStyle: { mode: 'fill', color: colorForSeed(seed), visible: true },
    });
    layer.reset();
  }

  async function restoreDraft(draft) {
    setMode(draft.slot);
    applyBlob({
      seed: draft.seed,
      params: draft.params,
      pathData: draft.pathData,
      genVersion: draft.genVersion,
      transform: draft.transform,
      blobStyle: draft.blobStyle,
      dailyDate: draft.dailyDate,
      title: draft.title,
      artworkId: draft.artworkId,
      createdAt: draft.createdAt,
      dirty: draft.dirty,
      unlocked: draft.unlocked,
    });
    await layer.load({ strokes: draft.strokes ?? [], baseBlob: draft.baseBlob ?? null });
    // A blank draft from before flips and stretches were removed has no art to line up with.
    if (!layer.hasArt) {
      const { rotate, scale } = state.transform;
      state.transform = { rotate, scale };
    }
  }

  function show() {
    renderBlob();
    syncControls();
  }

  /** Opens today's daily, filing away any unsaved art left over from an earlier day. */
  async function openDaily() {
    const today = localDateString();
    const draft = await getDraft('daily');
    if (draft && draft.dailyDate === today) {
      await restoreDraft(draft);
    } else {
      if (draft && draft.dirty && (draft.strokes?.length || draft.baseBlob)) {
        await restoreDraft(draft);
        if (layer.hasArt) {
          await saveArtwork({ quiet: true, countStreak: false });
          toast("Your unsaved drawing from an earlier day was saved to Mine.");
        }
      }
      freshDaily(today);
      await writeDraft();
    }
    show();
  }

  async function openFree() {
    const draft = await getDraft('free');
    if (draft) await restoreDraft(draft);
    else freshFree(randomSeed(), DEFAULT_PARAMS);
    show();
  }

  /** Asks before something would replace work that isn't saved. */
  async function okToDiscard(message) {
    if (!layer.hasArt) return true;
    return confirmDialog({
      title: 'Start over?',
      body: state.dirty ? `${message} Your drawing isn't saved and will be lost.` : `${message} Your saved copy stays in Mine.`,
      confirm: 'Start over',
      danger: state.dirty,
    });
  }

  async function newBlob() {
    if (state.mode !== 'free') {
      await flushAutosave();
      await openFree();
      return;
    }
    if (!(await okToDiscard('This replaces the current blob.'))) return;
    freshFree(randomSeed(), state.params);
    show();
    await writeDraft();
  }

  async function switchMode(mode) {
    await flushAutosave();
    if (mode === 'daily') await openDaily();
    else await openFree();
  }

  /** Won't overwrite unsaved art in the slot about to be replaced. */
  async function okToReplaceSlot(slot, message) {
    if (slot === state.mode) {
      // Saved art is safe in Mine, so only unsaved work needs a question here.
      if (!state.dirty) return true;
      return okToDiscard(message);
    }
    const draft = await getDraft(slot);
    if (!draft || !draft.dirty || !(draft.strokes?.length || draft.baseBlob)) return true;
    return confirmDialog({
      title: 'Replace your other drawing?',
      body: `${message} You have an unsaved drawing in ${slot === 'free' ? 'free play' : "today's blob"} that would be lost.`,
      confirm: 'Replace it',
      danger: true,
    });
  }

  async function openPastDate(date) {
    if (!(await okToReplaceSlot('free', `This opens the blob from ${formatDate(date)}.`))) {
      syncControls();
      return;
    }
    await flushAutosave();
    freshFree(dailySeed(date), dailyParams(date), `Splotch #${challengeNumber(date)}, ${formatDate(date)}`);
    show();
    await writeDraft();
  }

  /**
   * Reopens a saved artwork for more drawing.
   * @param {object} record an artwork from storage
   * @returns {Promise<boolean>} whether it opened
   */
  async function openArtwork(record) {
    const today = localDateString();
    const slot = record.isDaily && record.dailyDate === today ? 'daily' : 'free';
    if (!(await okToReplaceSlot(slot, `This opens "${record.title}".`))) return false;
    await flushAutosave();
    setMode(slot);
    applyBlob({
      seed: record.seed,
      params: record.params,
      pathData: record.pathData,
      genVersion: record.genVersion ?? GEN_VERSION,
      transform: record.transform,
      blobStyle: record.blobStyle,
      dailyDate: slot === 'daily' ? record.dailyDate : null,
      title: slot === 'free' ? record.title : '',
      artworkId: record.id,
      createdAt: record.createdAt,
    });
    await layer.load({ baseBlob: record.drawingPng });
    show();
    await writeDraft();
    return true;
  }

  // --- Saving and exporting ---

  const currentArt = () => ({
    pathData: state.pathData,
    transform: state.transform,
    blobStyle: state.blobStyle,
    drawing: layer.canvas,
  });

  async function saveArtwork({ quiet = false, countStreak = true } = {}) {
    if (!layer.hasArt) {
      toast('Draw something first!');
      return false;
    }
    const today = localDateString();
    const now = Date.now();
    const isTodaysDaily = state.dailyDate === today;
    const title = state.title
      || (state.dailyDate ? `Splotch #${challengeNumber(state.dailyDate)}` : `Free play ${state.seed}`);
    const id = state.artworkId ?? newId();
    const createdAt = state.createdAt ?? now;
    let drawingPng;
    let thumbPng;
    try {
      drawingPng = await canvasToBlob(layer.canvas);
      thumbPng = await canvasToBlob(renderPanel(currentArt(), THUMB_SIZE));
    } catch {
      toast("Couldn't make an image of that drawing.");
      return false;
    }
    const saved = await putArtwork({
      id,
      createdAt,
      updatedAt: now,
      seed: state.seed,
      params: state.params,
      pathData: state.pathData,
      genVersion: state.genVersion,
      transform: state.transform,
      blobStyle: state.blobStyle,
      drawingPng,
      thumbPng,
      isDaily: state.dailyDate !== null,
      dailyDate: state.dailyDate,
      title,
    });
    if (!saved) return false;
    state.artworkId = id;
    state.createdAt = createdAt;
    state.dirty = false;
    if (isTodaysDaily && countStreak) {
      streak = recordDaily(streak, today);
      writeSetting('streak', streak);
    }
    syncControls();
    await writeDraft();
    if (!quiet) {
      const days = currentStreak(streak, today);
      toast(isTodaysDaily && days > 0 ? `Saved to Mine. ${days} day streak!` : 'Saved to Mine.', {
        action: 'View',
        onAction: () => { window.location.hash = '#/mine'; },
      });
    }
    return true;
  }

  function openExportDialog() {
    const name = state.title || (state.dailyDate ? `splotch-${challengeNumber(state.dailyDate)}` : state.seed);
    openDialog((close) => {
      const choice = (kind, label, hint) => el('button', {
        type: 'button',
        class: 'choice',
        onclick: async () => {
          await downloadArt(kind, currentArt(), name);
          close();
        },
      }, el('strong', {}, label), el('span', {}, hint));
      return [
        el('h2', {}, 'Export'),
        el(
          'div',
          { class: 'choices' },
          choice('png', 'Artwork', 'A PNG, exactly as it looks now.'),
          choice('side', 'Side by side', 'A PNG with the blob next to your artwork.'),
          choice('svg', 'Blob only', 'An SVG of the blob, with no drawing.'),
        ),
        el(
          'div',
          { class: 'dialog-actions' },
          el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Cancel'),
        ),
      ];
    }, { label: 'Export' });
  }

  async function copyShareLink() {
    const url = `${window.location.origin}${window.location.pathname}${encodeShareQuery(state.seed, state.params)}#/draw`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. It opens this exact blob.');
    } catch {
      await openDialog((close) => [
        el('h2', {}, 'Share link'),
        el('input', { type: 'text', value: url, readOnly: true, 'aria-label': 'Share link' }),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Done')),
      ], { label: 'Share link' });
    }
  }

  // --- Controls ---

  function changed() {
    state.dirty = layer.hasArt ? true : state.dirty;
    renderBlob();
    syncControls();
    scheduleAutosave();
  }

  let regenFrame = null;
  function regenerate() {
    if (regenFrame !== null) return;
    regenFrame = requestAnimationFrame(() => {
      regenFrame = null;
      state.pathData = generateBlob({ seed: state.seed, params: state.params }).pathData;
      state.genVersion = GEN_VERSION;
      changed();
    });
  }

  function setTool(tool) {
    layer.tool.tool = tool;
    syncTool();
  }

  function setColor(color) {
    layer.tool.color = color;
    layer.tool.tool = 'brush';
    syncTool();
  }

  function setSize(size) {
    layer.tool.size = Math.max(2, Math.min(90, size));
    syncTool();
  }

  function toggleBlob() {
    state.blobStyle = { ...state.blobStyle, visible: !state.blobStyle.visible };
    changed();
  }

  function buildSwatches() {
    const host = $('swatches');
    for (const [color, name] of SWATCHES) {
      host.append(el('button', {
        type: 'button',
        class: 'swatch',
        'aria-label': name,
        title: name,
        'data-color': color,
        style: `--swatch:${color}`,
        onclick: () => setColor(color),
      }));
    }
    host.append(el('label', { class: 'swatch swatch-custom', title: 'Custom color' },
      el('span', { class: 'visually-hidden' }, 'Custom color'),
      el('input', { id: 'custom-color', type: 'color', oninput: (e) => setColor(e.target.value) })));

    const blobHost = $('blob-swatches');
    BLOB_COLORS.forEach((color, i) => {
      blobHost.append(el('button', {
        type: 'button',
        class: 'swatch',
        'aria-label': `${BLOB_COLOR_NAMES[i]} blob`,
        title: `${BLOB_COLOR_NAMES[i]} blob`,
        'data-color': color,
        style: `--swatch:${color}`,
        onclick: () => setBlobColor(color),
      }));
    });
    blobHost.append(el('label', { class: 'swatch swatch-custom', title: 'Custom blob color' },
      el('span', { class: 'visually-hidden' }, 'Custom blob color'),
      el('input', { id: 'blob-color', type: 'color', oninput: (e) => setBlobColor(e.target.value) })));
  }

  function setBlobColor(color) {
    state.blobStyle = { ...state.blobStyle, color };
    changed();
  }

  function wire() {
    buildSwatches();
    const saved = readSetting('brush', null);
    if (saved && typeof saved.color === 'string') layer.tool.color = saved.color;
    if (saved && Number.isFinite(saved.size)) layer.tool.size = saved.size;
    if (saved && typeof saved.pressure === 'boolean') layer.tool.pressure = saved.pressure;

    $('tool-brush').addEventListener('click', () => setTool('brush'));
    $('tool-eraser').addEventListener('click', () => setTool('eraser'));
    $('brush-size').addEventListener('input', (e) => setSize(Number(e.target.value)));
    $('undo').addEventListener('click', () => layer.undo());
    $('redo').addEventListener('click', () => layer.redo());
    $('clear').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Clear your drawing?',
        body: 'The blob stays. You can undo this.',
        confirm: 'Clear',
        danger: true,
      });
      if (ok) layer.clear();
    });
    $('toggle-blob').addEventListener('click', toggleBlob);

    $('save').addEventListener('click', () => saveArtwork());
    $('export').addEventListener('click', openExportDialog);
    $('post').addEventListener('click', () => {
      onPost({
        dailyDate: state.dailyDate,
        genVersion: state.genVersion,
        transform: state.transform,
        blobStyle: state.blobStyle,
        pathData: state.pathData,
        drawing: layer.canvas,
      });
    });

    $('go-free').addEventListener('click', () => switchMode('free'));
    $('go-daily').addEventListener('click', () => switchMode('daily'));
    $('new-blob').addEventListener('click', newBlob);
    $('share').addEventListener('click', copyShareLink);
    $('unlock').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Unlock the blob?',
        body: "If you change the blob now, it won't line up with what you've drawn.",
        confirm: 'Unlock',
      });
      if (ok) {
        state.unlocked = true;
        syncControls();
        scheduleAutosave();
      }
    });

    $('seed').addEventListener('change', (e) => {
      const seed = e.target.value.trim();
      if (!seed) {
        syncControls();
        return;
      }
      state.seed = seed;
      regenerate();
    });
    $('preset').addEventListener('change', (e) => {
      const preset = PRESETS[e.target.value];
      if (!preset) return;
      state.params = normalizeParams(preset);
      regenerate();
    });
    for (const input of document.querySelectorAll('[data-param]')) {
      input.addEventListener('input', () => {
        state.params = normalizeParams({ ...state.params, [input.dataset.param]: Number(input.value) });
        sliderOutput(input.dataset.param, state.params[input.dataset.param]);
        regenerate();
      });
    }
    for (const input of document.querySelectorAll('[data-transform]')) {
      input.addEventListener('input', () => {
        state.transform = { ...state.transform, [input.dataset.transform]: Number(input.value) };
        changed();
      });
    }
    $('t-reset').addEventListener('click', () => {
      state.transform = defaultTransform();
      changed();
    });

    for (const radio of document.querySelectorAll('input[name="blob-mode"]')) {
      radio.addEventListener('change', () => {
        state.blobStyle = { ...state.blobStyle, mode: radio.value, visible: true };
        changed();
      });
    }
    $('pen-pressure').addEventListener('change', (e) => {
      layer.tool.pressure = e.target.checked;
      syncTool();
    });
    $('past-date').addEventListener('change', async (e) => {
      const date = e.target.value;
      e.target.value = '';
      if (date && date >= LAUNCH_DATE && date < localDateString()) await openPastDate(date);
    });

    const panel = $('panel');
    const setPanel = (open) => {
      panel.classList.toggle('open', open);
      $('panel-toggle').setAttribute('aria-expanded', String(open));
    };
    $('panel-toggle').addEventListener('click', () => setPanel(!panel.classList.contains('open')));
    $('panel-close').addEventListener('click', () => setPanel(false));

    wireCursor();
    wireKeyboard();

    // Catch a save that's still waiting when the tab goes away, and notice midnight when it comes back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushAutosave();
      } else if (state.dailyDate && state.dailyDate !== localDateString()) {
        toast("It's a new day, and there's a new blob.", {
          action: 'Open it',
          onAction: () => switchMode('daily'),
        });
      }
    });
  }

  /** A ring showing the brush's real size. Only for mouse and pen, since fingers cover it. */
  function wireCursor() {
    const stage = $('stage');
    const cursor = $('cursor');
    const notePen = (e) => {
      if (e.pointerType === 'pen') $('pen-status').textContent = 'Pen detected.';
    };
    stage.addEventListener('pointerdown', notePen);
    stage.addEventListener('pointermove', (e) => {
      notePen(e);
      if (e.pointerType === 'touch') {
        cursor.hidden = true;
        return;
      }
      const rect = stage.getBoundingClientRect();
      const px = (layer.tool.size / ARTBOARD) * rect.width;
      cursor.hidden = false;
      cursor.style.width = `${px}px`;
      cursor.style.height = `${px}px`;
      cursor.style.transform = `translate(${e.clientX - rect.left - px / 2}px, ${e.clientY - rect.top - px / 2}px)`;
    });
    stage.addEventListener('pointerleave', () => { cursor.hidden = true; });
    stage.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') cursor.hidden = true; });
  }

  function wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!active || document.querySelector('dialog[open]')) return;
      const target = e.target;
      const typing = target instanceof HTMLElement
        && (target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'
          || (target.tagName === 'INPUT' && !['range', 'radio'].includes(target.type)));
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        saveArtwork();
        return;
      }
      if (typing) return;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) layer.redo();
        else layer.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        layer.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (key === 'b') setTool('brush');
      else if (key === 'e') setTool('eraser');
      else if (key === '[') setSize(layer.tool.size - (layer.tool.size > 20 ? 5 : 2));
      else if (key === ']') setSize(layer.tool.size + (layer.tool.size >= 20 ? 5 : 2));
      else if (key === 'n') newBlob();
      else if (key === 'h') toggleBlob();
    });
  }

  async function boot() {
    wire();
    const shared = decodeShareQuery(window.location.search);
    if (shared) {
      // Clean the URL so a refresh keeps the current work instead of reopening the link.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
      const draft = await getDraft('free');
      const sameBlob = draft && draft.seed === shared.seed
        && PARAM_KEYS.every((key) => normalizeParams(draft.params)[key] === shared.params[key]);
      if (sameBlob) {
        await restoreDraft(draft);
      } else if (draft && draft.dirty && (draft.strokes?.length || draft.baseBlob)) {
        // Unsaved free play art stays in its slot. Reach the link's blob through a new tab
        // only after asking, rather than overwriting that art on load.
        const ok = await confirmDialog({
          title: 'Open the shared blob?',
          body: 'You have an unsaved free play drawing, and opening this blob would replace it.',
          confirm: 'Open the blob',
          cancel: 'Keep my drawing',
          danger: true,
        });
        if (ok) freshFree(shared.seed, shared.params);
        else await restoreDraft(draft);
      } else {
        freshFree(shared.seed, shared.params);
      }
      show();
      return;
    }
    if (readSetting('lastMode', 'daily') === 'free') await openFree();
    else await openDaily();
  }

  return {
    ready: boot(),
    openArtwork,
    setActive(value) {
      active = value;
      if (!value) flushAutosave();
    },
  };
}
