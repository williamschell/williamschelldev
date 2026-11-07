// Small pieces shared between views.

import { addDays, localDateString } from '../dates.js';
import { el, formatDate, icon } from '../ui.js';

/**
 * Steps between days, and never past today.
 * @param {{ date: string, onChange: (date: string) => void }} config
 * @returns {HTMLElement}
 */
export function dateNav({ date, onChange }) {
  const today = localDateString();
  const label = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : formatDate(date);
  return el('div', { class: 'date-nav' },
    el('button', {
      type: 'button',
      class: 'icon-button',
      'aria-label': 'Previous day',
      onclick: () => onChange(addDays(date, -1)),
    }, icon('left')),
    el('span', { class: 'date-label', 'aria-live': 'polite' }, label),
    el('button', {
      type: 'button',
      class: 'icon-button',
      'aria-label': 'Next day',
      disabled: date >= today,
      onclick: () => onChange(addDays(date, 1)),
    }, icon('right')));
}

/**
 * @param {number} days
 * @returns {HTMLElement} the flame and number, or nothing visible at zero
 */
export function streakBadge(days) {
  return el('span', {
    class: days > 0 ? 'streak-badge' : 'streak-badge off',
    title: `${days}-day streak`,
    'aria-label': `${days}-day streak`,
  }, icon('flame'), String(days));
}

/**
 * The message shown when no backend is set up.
 * @returns {HTMLElement}
 */
export function notSetUp() {
  return el('div', { class: 'empty' },
    el('h2', {}, 'Comparing isn\'t set up yet'),
    el('p', {}, 'Your list, scores and streaks all work and stay on this device. Comparing with other people needs the database, which hasn\'t been connected here.'),
    el('p', {}, el('a', { class: 'button', href: '?demo#/compare' }, 'See it with made-up players')));
}
