// Dates and streaks. Dates are local-time "YYYY-MM-DD" strings. Day arithmetic happens in
// UTC so daylight saving can't shift it.

/** Novle #1. Set this to the real launch day. */
export const LAUNCH_DATE = '2026-11-05';

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
 * The date N days before a YYYY-MM-DD date.
 * @param {string} dateStr
 * @param {number} n
 * @returns {string}
 */
export function daysBefore(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateString(new Date(y, m - 1, d - n));
}

/**
 * @param {string} dateStr
 * @returns {number} the "Novle #N" number, where launch day is 1
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
 * Records a saved daily story on a date. Saving the same day again, or an earlier date after
 * a time-zone change, leaves the streak alone. The day after lastDate extends it, and any
 * longer gap starts over at 1.
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
