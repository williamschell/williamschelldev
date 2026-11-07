// Splotchle and Novle live on this same origin, so their saved streaks can be read directly.
//
// Read only. Never write to their keys, and never open their IndexedDB databases: opening one
// that doesn't exist creates it empty at version 1, so their own upgrade code would never run
// and their apps would break.

import { isDateString } from './dates.js';

/**
 * @param {string} key a localStorage key holding { lastDate, current, best }
 * @returns {{ lastDate: string, current: number, best: number }|null}
 */
export function readExternalStreak(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (!value || !isDateString(value.lastDate)) return null;
    const current = Number.isInteger(value.current) && value.current > 0 ? value.current : 0;
    const best = Number.isInteger(value.best) && value.best > 0 ? value.best : current;
    return { lastDate: value.lastDate, current, best };
  } catch {
    return null;
  }
}
