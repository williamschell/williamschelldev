// A row of color swatches. Click to use, right-click to remove, drag to reorder.

import { el } from '../../../splotchle/js/ui.js';

/**
 * @param {HTMLElement} host
 * @param {object} options
 * @param {() => string[]} options.get the current colors
 * @param {(colors: string[]) => void} options.set saves changed colors
 * @param {(color: string) => void} options.onPick
 * @param {() => string} [options.current] returns the color the + button adds
 * @param {string} options.label accessible name of the list
 * @returns {{ render: () => void }}
 */
export function swatchRow(host, {
  get, set, onPick, current, label,
}) {
  let dragFrom = null;

  const render = () => {
    const colors = get();
    const children = colors.map((color, i) => el('button', {
      type: 'button',
      class: 'swatch',
      style: `--swatch:${color}`,
      title: `${color}. Click to use, right-click to remove, drag to reorder.`,
      'aria-label': `Use ${color}`,
      draggable: true,
      onclick: () => onPick(color),
      oncontextmenu: (e) => {
        e.preventDefault();
        set(colors.filter((_, k) => k !== i));
        render();
      },
      ondragstart: (e) => {
        dragFrom = i;
        e.dataTransfer.effectAllowed = 'move';
        // Firefox won't start a drag without data.
        e.dataTransfer.setData('text/plain', color);
      },
      ondragover: (e) => e.preventDefault(),
      ondrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragFrom === null || dragFrom === i) return;
        const next = [...colors];
        const [moved] = next.splice(dragFrom, 1);
        next.splice(i, 0, moved);
        dragFrom = null;
        set(next);
        render();
      },
    }));
    if (current) {
      children.push(el('button', {
        type: 'button',
        class: 'swatch swatch-add',
        title: 'Add the current color',
        'aria-label': 'Add the current color',
        onclick: () => {
          const color = current();
          if (!get().includes(color)) {
            set([...get(), color]);
            render();
          }
        },
      }, '+'));
    }
    host.replaceChildren(...children);
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', label);
  };
  render();
  return { render };
}
