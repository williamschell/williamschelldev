// App-wide settings and key bindings, kept in localStorage. Everything a project owns lives in the
// project instead.

const PREFIX = 'modelpainter:';

/** Every remappable keyboard action, in the order the settings panel lists them. */
export const ACTIONS = [
  { id: 'passLit', label: 'Lit pass', key: 'Digit1' },
  { id: 'passShadow', label: 'Shadow pass', key: 'Digit2' },
  { id: 'passEdge', label: 'Edge pass', key: 'Digit3' },
  { id: 'previewCycle', label: 'Cycle preview mode', key: 'KeyV' },
  { id: 'viewToggle', label: '3D / UV view', key: 'Tab' },
  { id: 'viewSplit', label: 'Split view', key: 'Shift+Tab' },
  { id: 'frame', label: 'Frame the model', key: 'KeyF' },
  { id: 'wire', label: 'UV wireframe', key: 'KeyW' },
  { id: 'lightDrag', label: 'Hold to drag the light', key: 'KeyL' },
  { id: 'undo', label: 'Undo', key: 'Ctrl+KeyZ' },
  { id: 'redo', label: 'Redo', key: 'Ctrl+Shift+KeyZ' },
  { id: 'redoAlt', label: 'Redo (second key)', key: 'Ctrl+KeyY' },
  { id: 'brushPencil', label: 'Pencil', key: 'KeyN' },
  { id: 'brushPen', label: 'Pen', key: 'KeyP' },
  { id: 'brushMarker', label: 'Marker', key: 'KeyM' },
  { id: 'brushPaint', label: 'Paintbrush', key: 'KeyB' },
  { id: 'toolEraser', label: 'Eraser', key: 'KeyE' },
  { id: 'toolFill', label: 'Fill bucket', key: 'KeyG' },
  { id: 'toolEyedropper', label: 'Eyedropper', key: 'KeyI' },
  { id: 'sizeDown', label: 'Smaller brush', key: 'BracketLeft' },
  { id: 'sizeUp', label: 'Bigger brush', key: 'BracketRight' },
  { id: 'opacityDown', label: 'Lower opacity', key: 'Shift+BracketLeft' },
  { id: 'opacityUp', label: 'Higher opacity', key: 'Shift+BracketRight' },
  { id: 'flyForward', label: 'Fly forward', key: 'KeyW', fly: true },
  { id: 'flyBack', label: 'Fly back', key: 'KeyS', fly: true },
  { id: 'flyLeft', label: 'Fly left', key: 'KeyA', fly: true },
  { id: 'flyRight', label: 'Fly right', key: 'KeyD', fly: true },
  { id: 'flyDown', label: 'Fly down', key: 'KeyQ', fly: true },
  { id: 'flyUp', label: 'Fly up', key: 'KeyE', fly: true },
];

export const DEFAULTS = {
  theme: 'auto',
  flyButton: 2, // right mouse
  orbitButton: 1, // middle mouse
  spaceGestures: true, // Space + drag = orbit, Space + Shift = pan, Space + Ctrl = zoom
  usePressure: true,
  pressureCurve: 1,
  worldSizeBrush: false,
  dilation: 8,
  eyedropSource: 'texel', // or 'final'
  globalPalette: ['#1b1a17', '#ffffff', '#c7402d', '#e8a33d', '#3d8b4f', '#2f6fb0', '#6b4fa0', '#7a4f33'],
  recentColors: [],
  keys: {},
};

/** Reads a stored value. Private browsing or a full quota should never break the app. */
function read(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Settings just won't stick this session.
  }
}

export const settings = {
  ...DEFAULTS,
  ...(read('settings') ?? {}),
};

/** Merges in changes and saves. */
export function saveSettings(changes = {}) {
  Object.assign(settings, changes);
  write('settings', settings);
}

export function resetBindings() {
  saveSettings({
    keys: {}, flyButton: DEFAULTS.flyButton, orbitButton: DEFAULTS.orbitButton, spaceGestures: true,
  });
}

/** @returns {string} the current binding for an action */
export function bindingFor(id) {
  return settings.keys[id] ?? ACTIONS.find((a) => a.id === id).key;
}

/**
 * Normalizes a key event to a binding string like 'Ctrl+Shift+KeyZ'. Uses physical key codes, so
 * WASD and the brackets stay in the same place on any keyboard layout.
 * @param {KeyboardEvent} e
 * @returns {string}
 */
export function bindingOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

const KEY_NAMES = {
  BracketLeft: '[', BracketRight: ']', Space: 'Space', Tab: 'Tab', Escape: 'Esc',
};

/** @returns {string} a binding as people would write it */
export function prettyBinding(binding) {
  return binding.split('+').map((part) => {
    if (KEY_NAMES[part]) return KEY_NAMES[part];
    if (part.startsWith('Key')) return part.slice(3);
    if (part.startsWith('Digit')) return part.slice(5);
    return part;
  }).join('+');
}

/**
 * The action a key event triggers. Fly keys only count during free-fly, and everything else only
 * outside it, so W can mean forward and also toggle the wireframe.
 * @param {KeyboardEvent} e
 * @returns {string|null}
 */
export function actionFor(e) {
  const binding = bindingOf(e);
  for (const action of ACTIONS) {
    if (!action.fly && bindingFor(action.id) === binding) return action.id;
  }
  return null;
}
