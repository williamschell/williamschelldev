// Local dates as "YYYY-MM-DD" strings. Day arithmetic happens in UTC so daylight saving
// can't shift it.

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
 * @param {number} days may be negative
 * @returns {string}
 */
export function addDays(dateStr, days) {
  return new Date((toUtcDay(dateStr) + days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * @param {unknown} value
 * @returns {boolean} whether this is a real date in YYYY-MM-DD form
 */
export function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}
