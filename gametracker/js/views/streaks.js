// The Streaks view: your overall streak, then each game with a 12-week calendar.

import { addDays, localDateString } from '../dates.js';
import {
  gameStreak, myGames, overallStreak, playedDates,
} from '../store.js';
import { el, externalLink, formatDate, icon } from '../ui.js';

const WEEKS = 12;

const stat = (value, label) => el('div', { class: 'stat' },
  el('span', { class: 'stat-value' }, String(value)),
  el('span', { class: 'stat-label' }, label));

/**
 * Columns are weeks, Sunday at the top, ending with the week containing today. The cells after
 * today are left blank so the shape of the grid doesn't change through the week.
 */
function calendar(game, today) {
  const played = new Set(playedDates(game.id));
  const [y, m, d] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const start = addDays(today, -weekday - (WEEKS - 1) * 7);

  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const date = addDays(start, i);
    if (date > today) return el('span', { class: 'cell future' });
    const on = played.has(date);
    return el('span', {
      class: on ? 'cell on' : 'cell',
      title: `${formatDate(date)}: ${on ? 'played' : 'not played'}`,
    });
  });
  const count = cells.filter((cell) => cell.classList.contains('on')).length;
  return el('div', {
    class: 'calendar',
    role: 'img',
    'aria-label': `${game.name}: played on ${count} days in the last ${WEEKS} weeks`,
  }, ...cells);
}

/** @param {HTMLElement} host */
export function renderStreaks(host) {
  const today = localDateString();
  const overall = overallStreak(today);
  const games = myGames();

  host.replaceChildren(
    el('section', { class: 'stats-hero' },
      el('h1', {}, 'Your streaks'),
      el('div', { class: 'stats' },
        stat(overall.current, 'Day streak'),
        stat(overall.best, 'Best'),
        stat(overall.total, 'Days played')),
      el('p', { class: 'muted small' }, 'Any game on your list keeps this one going.')),
    games.length === 0
      ? el('div', { class: 'empty' }, el('p', {}, 'Add some games to start a streak.'), el('a', { class: 'button primary', href: '#/games' }, 'Choose games'))
      : el('div', { class: 'streak-list' }, ...games.map((game) => {
        const streak = gameStreak(game.id, today);
        return el('article', { class: 'streak-card' },
          el('div', { class: 'game-title' },
            el('h2', {}, game.name),
            externalLink(game.url, { class: 'icon-button', 'aria-label': `Play ${game.name}`, title: `Play ${game.name}` }, icon('external'))),
          el('div', { class: 'stats' },
            stat(streak.current, 'Current'),
            stat(streak.best, 'Best'),
            stat(streak.total, 'Total')),
          calendar(game, today));
      })),
  );
}
