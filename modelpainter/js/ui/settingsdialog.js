// Settings: remappable keys and camera buttons. Pen barrel buttons usually send right or middle
// clicks, so these need to be movable for tablets.

import { el, openDialog } from '../../../splotchle/js/ui.js';
import {
  ACTIONS, bindingFor, bindingOf, prettyBinding, resetBindings, saveSettings, settings,
} from '../core/settings.js';

const MOUSE_BUTTONS = [[2, 'Right button'], [1, 'Middle button'], [-1, 'None']];
const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** Opens the settings dialog. */
export function openSettings() {
  return openDialog((close) => {
    const rows = el('div', { class: 'bindings' });
    let capture = null;

    const stopCapture = () => {
      if (!capture) return;
      window.removeEventListener('keydown', capture, true);
      capture = null;
    };

    const renderRows = () => {
      stopCapture();
      rows.replaceChildren(...ACTIONS.map((action) => {
        const button = el('button', {
          type: 'button',
          class: 'button small binding',
          'aria-label': `Change the key for ${action.label}`,
        }, prettyBinding(bindingFor(action.id)));
        button.addEventListener('click', () => {
          stopCapture();
          button.textContent = 'Press a key…';
          capture = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.code === 'Escape') {
              renderRows();
              return;
            }
            if (MODIFIER_CODES.has(e.code)) return;
            // Keys that get held are read on their own, with no modifiers involved.
            const binding = action.fly || action.id === 'lightDrag' ? e.code : bindingOf(e);
            saveSettings({ keys: { ...settings.keys, [action.id]: binding } });
            renderRows();
          };
          window.addEventListener('keydown', capture, true);
        });
        return el('div', { class: 'binding-row' }, el('span', {}, action.label), button);
      }));
    };
    renderRows();

    const buttonSelect = (label, key) => {
      const select = el('select', { 'aria-label': label },
        ...MOUSE_BUTTONS.map(([value, name]) => el('option', { value }, name)));
      select.value = String(settings[key]);
      select.addEventListener('change', () => saveSettings({ [key]: Number(select.value) }));
      return el('label', { class: 'field' }, label, select);
    };

    const space = el('input', { type: 'checkbox', checked: settings.spaceGestures });
    space.addEventListener('change', () => saveSettings({ spaceGestures: space.checked }));

    return [
      el('h2', {}, 'Settings'),
      el('h3', { class: 'mini-heading' }, 'Camera'),
      buttonSelect('Free-fly (hold)', 'flyButton'),
      buttonSelect('Orbit (drag; Shift pans)', 'orbitButton'),
      el('label', { class: 'check-field' }, space, el('span', {}, 'Pen scheme: Space + drag orbits, Space + Shift pans, Space + Ctrl zooms')),
      el('h3', { class: 'mini-heading' }, 'Keys'),
      rows,
      el('div', { class: 'dialog-actions' },
        el('button', {
          type: 'button',
          class: 'button',
          onclick: () => {
            resetBindings();
            stopCapture();
            close();
            openSettings();
          },
        }, 'Reset to defaults'),
        el('button', {
          type: 'button',
          class: 'button primary',
          onclick: () => {
            stopCapture();
            close();
          },
        }, 'Done')),
    ];
  }, { label: 'Settings', wide: true });
}
