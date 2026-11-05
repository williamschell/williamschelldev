// Shared DOM helpers: element building, toasts, dialogs and icons.

/**
 * Small element builder. Children are always added as text or nodes, never parsed as
 * HTML, so anything a user typed is safe to pass in.
 * @param {string} tag
 * @param {Record<string, any>} [attrs] on* keys become listeners; class, aria-* and data-* become attributes
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

// Resolved from this module, so icons work from pages in other folders too.
const SPRITE_URL = new URL('../assets/icons/sprite.svg', import.meta.url).href;

/**
 * An SVG icon from the sprite. It inherits the text color.
 * @param {string} name
 * @returns {SVGSVGElement}
 */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `${SPRITE_URL}#${name}`);
  svg.append(use);
  return svg;
}

let toastTimer = null;

/**
 * Shows a brief message.
 * @param {string} message
 * @param {{ action?: string, onAction?: () => void }} [options]
 */
export function toast(message, { action, onAction } = {}) {
  const host = document.getElementById('toast');
  host.replaceChildren(el('span', {}, message));
  if (action) {
    host.append(el('button', {
      type: 'button',
      class: 'link-button',
      onclick: () => {
        host.classList.remove('show');
        onAction?.();
      },
    }, action));
  }
  host.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('show'), action ? 8000 : 3500);
}

/**
 * Opens a modal built from the content given. Removes itself when closed.
 * @param {(close: (value?: any) => void) => Node[]} build returns the dialog's children
 * @param {{ wide?: boolean, label?: string, className?: string }} [options]
 * @returns {Promise<any>} resolves to the value passed to close, or undefined on Esc
 */
export function openDialog(build, { wide = false, label, className = '' } = {}) {
  return new Promise((resolve) => {
    const classes = ['dialog', wide ? 'wide' : '', className].filter(Boolean).join(' ');
    const dialog = el('dialog', { class: classes, 'aria-label': label });
    let result;
    const close = (value) => {
      result = value;
      dialog.close();
    };
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close(undefined);
    });
    dialog.append(...build(close));
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * A yes/no question.
 * @param {{ title: string, body?: string, confirm?: string, cancel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export async function confirmDialog({ title, body, confirm = 'OK', cancel = 'Cancel', danger = false }) {
  const answer = await openDialog((close) => [
    el('h2', {}, title),
    body ? el('p', {}, body) : null,
    el(
      'div',
      { class: 'dialog-actions' },
      el('button', { type: 'button', class: 'button', onclick: () => close(false) }, cancel),
      el('button', {
        type: 'button',
        class: danger ? 'button danger' : 'button primary',
        onclick: () => close(true),
      }, confirm),
    ),
  ].filter(Boolean), { label: title });
  return answer === true;
}

/**
 * A stable-enough id. crypto.randomUUID only exists on secure origins, so testing on a
 * phone over plain LAN http needs the fallback.
 * @returns {string}
 */
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Formats YYYY-MM-DD for reading, without letting the time zone shift the day.
 * @param {string} dateStr
 * @returns {string}
 */
export function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}
