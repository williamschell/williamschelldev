// Shared DOM helpers: element building, icons, toasts, dialogs, downloads and printing.

/**
 * Small element builder. Children are always added as text or nodes, never parsed as
 * HTML, so anything typed in is safe to pass in.
 * @param {string} tag
 * @param {Record<string, any>} [attrs] on* keys become listeners; class, aria-* and data-* become attributes
 * @param {...(Node|string|number|null|undefined|false)} children
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

/**
 * An icon-only button. The label is read out and shown as a tooltip.
 * @param {string} name icon
 * @param {string} label
 * @param {() => void} onclick
 * @param {Record<string, any>} [attrs]
 * @returns {HTMLButtonElement}
 */
export function iconButton(name, label, onclick, attrs = {}) {
  return el('button', {
    type: 'button', class: 'icon-button', 'aria-label': label, title: label, onclick, ...attrs,
  }, icon(name));
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
 * @param {{ label?: string, wide?: boolean }} [options]
 * @returns {Promise<any>} resolves to the value passed to close, or undefined on Esc
 */
export function openDialog(build, { label, wide = false } = {}) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const dialog = el('dialog', { class: wide ? 'dialog wide' : 'dialog', 'aria-label': label });
    let result;
    const close = (value) => {
      result = value;
      dialog.close();
    };
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
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
export async function confirmDialog({
  title, body, confirm = 'OK', cancel = 'Cancel', danger = false,
}) {
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
 * A row of mutually exclusive buttons.
 * @param {{ label: string, value: string, options: { value: string, label: string }[], onChange: (value: string) => void, focusKey?: string }} config
 * @returns {HTMLElement}
 */
export function segmented({
  label, value, options, onChange, focusKey = '',
}) {
  return el('div', { class: 'segmented', role: 'group', 'aria-label': label }, ...options.map((option) => el('button', {
    type: 'button',
    'aria-pressed': String(option.value === value),
    'data-focus': `${focusKey}:${option.value}`,
    onclick: () => onChange(option.value),
  }, option.label)));
}

/**
 * Redraws a view and puts focus back on the control that had it, matched by data-focus.
 * @param {HTMLElement} host
 * @param {() => Node[]} build
 * @param {string} [focus] a data-focus value to focus instead
 */
export function redrawKeepingFocus(host, build, focus) {
  const active = document.activeElement;
  const key = focus ?? (host.contains(active) ? active.dataset?.focus : undefined);
  const scroll = window.scrollY;
  host.replaceChildren(...build());
  if (key) {
    const target = host.querySelector(`[data-focus="${CSS.escape(key)}"]`);
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
    } else if (target) {
      // A button that just became disabled (an arrow at the end of the line) hands focus
      // to the main control of whatever it belongs to.
      const home = target.closest('[data-focus-home]');
      home?.querySelector(home.dataset.focusHome)?.focus({ preventScroll: true });
    }
  }
  window.scrollTo(0, scroll);
}

/**
 * Lets a textarea grow with what's written in it.
 * @param {HTMLTextAreaElement} area
 */
export function autoGrow(area) {
  const fit = () => {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight + 2}px`;
  };
  area.addEventListener('input', fit);
  requestAnimationFrame(fit);
}

/**
 * Saves text as a file.
 * @param {string} name file name
 * @param {string} contents
 * @param {string} mime
 */
export function download(name, contents, mime) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const link = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/**
 * Copies text, falling back to a hidden textarea where the clipboard API isn't allowed.
 * @param {string} contents
 * @returns {Promise<boolean>}
 */
export async function copyText(contents) {
  try {
    await navigator.clipboard.writeText(contents);
    return true;
  } catch {
    const area = el('textarea', { value: contents, class: 'offscreen', 'aria-hidden': 'true' });
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/**
 * Prints just the text given, on plain paper.
 * @param {string} title
 * @param {string} contents
 */
export function printText(title, contents) {
  const area = document.getElementById('print-area');
  area.replaceChildren(el('h1', {}, title), el('pre', {}, contents));
  const clear = () => {
    area.replaceChildren();
    window.removeEventListener('afterprint', clear);
  };
  window.addEventListener('afterprint', clear);
  window.print();
}

/**
 * Today as YYYY-MM-DD in the local time zone.
 * @returns {string}
 */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A YYYY-MM-DD date for reading, without letting the time zone shift the day.
 * @param {string} date
 * @returns {string}
 */
export function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return value.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
