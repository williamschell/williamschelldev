// Daily challenge: date -> seed and params, plus streak math. Dates are local-time
// "YYYY-MM-DD" strings. Day arithmetic happens in UTC so daylight saving can't shift it.

import { createRng } from './rng.js';
import { PRESETS } from './blob.js';

/** Splotch #1. */
export const LAUNCH_DATE = '2026-11-04';

const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {Date} [date]
 * @returns {string} the user's local date as YYYY-MM-DD
 */
export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const toUtcDay = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

/**
 * Whole days from a to b.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  return Math.round(toUtcDay(b) - toUtcDay(a));
}

/**
 * @param {string} dateStr
 * @returns {string}
 */
export function dailySeed(dateStr) {
  return `daily-${dateStr}`;
}

/**
 * @param {string} dateStr
 * @returns {number} the "Splotch #N" number, where launch day is 1
 */
export function challengeNumber(dateStr) {
  return daysBetween(LAUNCH_DATE, dateStr) + 1;
}

/**
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isSunday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/**
 * The date decides the difficulty as well as the seed. Sundays are Cursed.
 * @param {string} dateStr
 * @returns {import('./blob.js').BlobParams}
 */
export function dailyParams(dateStr) {
  if (isSunday(dateStr)) return { ...PRESETS.cursed };
  const rng = createRng(`params-${dateStr}`);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  return {
    complexity: r3(rng.range(0.3, 0.8)),
    lobes: rng.int(2, 5),
    holes: rng.pick([0, 0, 1, 1, 2]),
    protrusions: rng.int(1, 6),
    aspect: r3(rng.range(0.75, 1.35)),
    smoothness: r3(rng.range(0.45, 0.85)),
  };
}

/**
 * @typedef {object} Streak
 * @property {string|null} lastDate
 * @property {number} current
 * @property {number} best
 */

/** @returns {Streak} */
export function emptyStreak() {
  return { lastDate: null, current: 0, best: 0 };
}

/**
 * Records a saved daily on a date. Saving the same day again, or an earlier date after
 * a time-zone change, leaves the streak alone. The day after lastDate extends it, and
 * any longer gap starts over at 1.
 * @param {Streak} streak
 * @param {string} dateStr
 * @returns {Streak}
 */
export function recordDaily(streak, dateStr) {
  if (!streak.lastDate) return { lastDate: dateStr, current: 1, best: Math.max(1, streak.best) };
  const gap = daysBetween(streak.lastDate, dateStr);
  if (gap <= 0) return { ...streak };
  const current = gap === 1 ? streak.current + 1 : 1;
  return { lastDate: dateStr, current, best: Math.max(streak.best, current) };
}

/**
 * The streak as of today: still alive if the last save was today or yesterday, otherwise
 * zero. Never negative, even if lastDate is ahead of today after a time-zone change.
 * @param {Streak} streak
 * @param {string} today
 * @returns {number}
 */
export function currentStreak(streak, today) {
  if (!streak.lastDate) return 0;
  return daysBetween(streak.lastDate, today) <= 1 ? Math.max(0, streak.current) : 0;
}
