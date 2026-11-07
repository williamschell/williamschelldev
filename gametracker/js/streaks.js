// Streak math. A streak is a run of consecutive days, and it stays alive until a whole day
// goes by with nothing logged, so it doesn't read as broken first thing in the morning.

import { daysBetween } from './dates.js';

/**
 * @typedef {object} Streak
 * @property {number} current the run still alive today, or 0
 * @property {number} best the longest run ever
 * @property {number} total how many days were played
 * @property {string|null} lastDate
 */

/**
 * @param {Iterable<string>} dates the days played, in any order, duplicates allowed
 * @param {string} today
 * @returns {Streak}
 */
export function computeStreak(dates, today) {
  const days = [...new Set(dates)].sort();
  if (days.length === 0) return { current: 0, best: 0, total: 0, lastDate: null };

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  // run now holds the length of the last run. A date ahead of today can happen after a
  // time-zone change, and it still counts as alive.
  const lastDate = days[days.length - 1];
  const current = daysBetween(lastDate, today) <= 1 ? run : 0;
  return { current, best, total: days.length, lastDate };
}

/**
 * Combines our streak with one kept by the game itself, which may go back further than the
 * days logged here.
 * @param {Streak} own
 * @param {{ lastDate: string, current: number, best: number }|null} external
 * @param {string} today
 * @returns {Streak}
 */
export function mergeExternalStreak(own, external, today) {
  if (!external) return own;
  const alive = daysBetween(external.lastDate, today) <= 1;
  return {
    ...own,
    current: Math.max(own.current, alive ? external.current : 0),
    best: Math.max(own.best, external.best),
  };
}
