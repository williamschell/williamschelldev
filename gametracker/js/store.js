// The game list and results. Everything is held in memory after startup and written through
// to IndexedDB and localStorage. Nothing here throws on a storage failure: private browsing or
// a full quota shows a message, and the app carries on for this visit.

import { isDemo, getBackend } from './backend.js';
import { daysBetween, isDateString, localDateString } from './dates.js';
import {
  catalogGame, DEFAULT_GAMES, isWebUrl, makeCustomGame,
} from './catalog.js';
import { cleanResult } from './scores.js';
import { readExternalStreak } from './external.js';
import { computeStreak, mergeExternalStreak } from './streaks.js';

const DB_NAME = isDemo ? 'gametracker-demo' : 'gametracker';
const PREFIX = isDemo ? 'gametracker-demo:' : 'gametracker:';
const STORE = 'results';
const SYNC_WINDOW_DAYS = 7;
const BACKUP_APP = 'gametracker';
const SAVE_FAILED = 'Couldn\'t save on this device. Private browsing or a full disk can cause this.';

/** @type {Map<string, object>} every result by "gameId|date", including deleted tombstones */
const results = new Map();
let dbPromise = null;
let errorListener = () => {};

const keyOf = (gameId, date) => `${gameId}|${date}`;

/** @param {(message: string) => void} listener hears about storage failures */
export function onStorageError(listener) {
  errorListener = listener;
}

function changed() {
  scheduleSync();
}

/* ---------------------------- settings ---------------------------- */

/**
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function readSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function writeSetting(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    errorListener(SAVE_FAILED);
  }
}

/* ---------------------------- IndexedDB ---------------------------- */

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function dbRun(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function persist(row) {
  dbRun('readwrite', (s) => s.put(row)).catch((err) => {
    console.warn('Streakle storage:', err);
    errorListener(SAVE_FAILED);
  });
}

function unpersist(key) {
  dbRun('readwrite', (s) => s.delete(key)).catch((err) => {
    console.warn('Streakle storage:', err);
    errorListener(SAVE_FAILED);
  });
}

/** Loads everything into memory. Call once before using anything else here. */
export async function initStore() {
  try {
    const rows = await dbRun('readonly', (s) => s.getAll());
    for (const row of rows) results.set(row.key, row);
  } catch (err) {
    console.warn('Streakle storage:', err);
    errorListener('Couldn\'t read your saved results on this device.');
  }
}

/* ---------------------------- games ---------------------------- */

/** @returns {import('./catalog.js').Game[]} custom games, whether on the list or not */
export function customGames() {
  const saved = readSetting('customGames', []);
  return Array.isArray(saved) ? saved : [];
}

/**
 * @param {string} id
 * @returns {import('./catalog.js').Game|undefined}
 */
export function findGame(id) {
  return catalogGame(id) ?? customGames().find((game) => game.id === id);
}

/** @returns {import('./catalog.js').Game[]} the person's list, in their order */
export function myGames() {
  const ids = readSetting('games', DEFAULT_GAMES);
  return (Array.isArray(ids) ? ids : DEFAULT_GAMES).map(findGame).filter(Boolean);
}

const saveList = (games) => writeSetting('games', games.map((game) => game.id));

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isOnList(id) {
  return myGames().some((game) => game.id === id);
}

/** @param {string} id a game already in the catalog or the custom list */
export function addGame(id) {
  if (isOnList(id) || !findGame(id)) return;
  saveList([...myGames(), findGame(id)]);
  changed();
}

/** Takes a game off the list. Its history is kept, so adding it back restores it. */
export function removeGame(id) {
  saveList(myGames().filter((game) => game.id !== id));
  changed();
}

/**
 * @param {string} id
 * @param {-1|1} direction
 */
export function moveGame(id, direction) {
  const games = myGames();
  const from = games.findIndex((game) => game.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= games.length) return;
  [games[from], games[to]] = [games[to], games[from]];
  saveList(games);
  changed();
}

/**
 * Saves a custom game and puts it on the list.
 * @param {object} input see makeCustomGame
 * @returns {string|null} an error message, or null if it worked
 */
export function addCustomGame(input) {
  const made = makeCustomGame(input);
  if ('error' in made) return made.error;
  const others = customGames().filter((game) => game.id !== made.game.id);
  writeSetting('customGames', [...others, made.game]);
  addGame(made.game.id);
  changed();
  return null;
}

/* ---------------------------- results ---------------------------- */

/**
 * @param {string} gameId
 * @param {string} date
 * @returns {object|null} the live result, if there is one
 */
export function getResult(gameId, date) {
  const row = results.get(keyOf(gameId, date));
  return row && !row.deleted ? row : null;
}

const liveRows = () => [...results.values()].filter((row) => !row.deleted);

/**
 * Logs a result, replacing any already there for that day.
 * @param {string} gameId
 * @param {string} date
 * @param {{ score: number|null, failed: boolean }} result
 * @param {'manual'|'paste'|'auto'} [source]
 */
export function logResult(gameId, date, { score, failed }, source = 'manual') {
  const key = keyOf(gameId, date);
  const row = {
    key,
    gameId,
    date,
    score,
    failed,
    source,
    updatedAt: Date.now(),
    synced: false,
    deleted: false,
    // Remembers that the server has a copy, so clearing this later still tells the server.
    everSynced: results.get(key)?.everSynced ?? false,
  };
  results.set(key, row);
  persist(row);
  changed();
}

/**
 * Clears a result. If the server has it, a tombstone stays until the server has been told.
 * @param {string} gameId
 * @param {string} date
 */
export function clearResult(gameId, date) {
  const key = keyOf(gameId, date);
  const row = results.get(key);
  if (!row) return;
  if (row.everSynced) {
    const tombstone = {
      ...row, deleted: true, synced: false, updatedAt: Date.now(),
    };
    results.set(key, tombstone);
    persist(tombstone);
  } else {
    results.delete(key);
    unpersist(key);
  }
  changed();
}

/**
 * Picks up plays from Splotchle and Novle, which keep their own streaks on this origin.
 * @returns {boolean} whether anything new was logged
 */
export function collectAutoResults() {
  let added = false;
  for (const game of myGames()) {
    if (!game.autoKey) continue;
    const external = readExternalStreak(game.autoKey);
    if (external && !getResult(game.id, external.lastDate)) {
      logResult(game.id, external.lastDate, { score: null, failed: false }, 'auto');
      added = true;
    }
  }
  return added;
}

/* ---------------------------- streaks ---------------------------- */

/**
 * @param {string} gameId
 * @returns {string[]} every day this game was played
 */
export function playedDates(gameId) {
  return liveRows().filter((row) => row.gameId === gameId).map((row) => row.date);
}

/**
 * @param {string} gameId
 * @param {string} [today]
 * @returns {import('./streaks.js').Streak}
 */
export function gameStreak(gameId, today = localDateString()) {
  const own = computeStreak(playedDates(gameId), today);
  const game = findGame(gameId);
  return game?.autoKey ? mergeExternalStreak(own, readExternalStreak(game.autoKey), today) : own;
}

/**
 * Days with at least one game on the current list logged.
 * @param {string} [today]
 * @returns {import('./streaks.js').Streak}
 */
export function overallStreak(today = localDateString()) {
  const ids = new Set(myGames().map((game) => game.id));
  return computeStreak(liveRows().filter((row) => ids.has(row.gameId)).map((row) => row.date), today);
}

/* ---------------------------- sync ---------------------------- */

let syncTimer = null;
let syncing = null;

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 800);
}

async function pushPending() {
  const backend = await getBackend();
  if (!backend.isConfigured || !await backend.getAccount()) return;

  // The server refuses dates older than this, so anything older just stays on this device.
  const today = localDateString();
  const pending = [...results.values()].filter((row) => !row.synced
    && daysBetween(row.date, today) <= SYNC_WINDOW_DAYS);

  const toDelete = pending.filter((row) => row.deleted);
  for (const row of toDelete) {
    await backend.deleteResult(row.gameId, row.date);
    if (results.get(row.key)?.updatedAt === row.updatedAt) {
      results.delete(row.key);
      unpersist(row.key);
    }
  }

  const toSave = pending.filter((row) => !row.deleted);
  if (toSave.length > 0) {
    await backend.saveResults(toSave);
    for (const row of toSave) {
      // If it changed while the request was out, leave it marked for the next sync.
      if (results.get(row.key)?.updatedAt === row.updatedAt) {
        const done = { ...row, synced: true, everSynced: true };
        results.set(row.key, done);
        persist(done);
      }
    }
  }
}

/**
 * Sends anything the server hasn't seen. Does nothing until the person has joined. Failures
 * are quiet, because everything stays marked and the next sync tries again.
 * @returns {Promise<void>}
 */
export function syncNow() {
  clearTimeout(syncTimer);
  if (!syncing) {
    syncing = pushPending()
      .catch((err) => console.warn('Streakle sync:', err))
      .finally(() => { syncing = null; });
  }
  return syncing;
}

/** After leaving, the server has nothing, so everything counts as unsent if they rejoin. */
export function markAllUnsynced() {
  for (const [key, row] of [...results]) {
    if (row.deleted) {
      results.delete(key);
      unpersist(key);
    } else {
      const fresh = { ...row, synced: false, everSynced: false };
      results.set(key, fresh);
      persist(fresh);
    }
  }
}

/* ---------------------------- backup ---------------------------- */

/** @returns {object} everything on this device, ready to save as JSON */
export function makeBackup() {
  return {
    app: BACKUP_APP,
    version: 1,
    exportedAt: new Date().toISOString(),
    games: myGames().map((game) => game.id),
    customGames: customGames(),
    results: liveRows().map(({
      gameId, date, score, failed, source,
    }) => ({
      gameId, date, score, failed, source,
    })),
  };
}

/**
 * Merges a backup in. A result already here for the same day is kept, so restoring an old
 * file can't overwrite newer scores. Everything from the file is checked first, since it may
 * have been edited or come from anywhere.
 * @param {any} data
 * @returns {{ error: string } | { added: number }}
 */
export function restoreBackup(data) {
  if (data?.app !== BACKUP_APP || !Array.isArray(data.results)) {
    return { error: 'That isn\'t a Streakle backup file.' };
  }
  const customs = customGames();
  for (const entry of Array.isArray(data.customGames) ? data.customGames : []) {
    // Rebuilding it through the same rules is what stops a bad link getting in.
    const made = isWebUrl(entry?.url) ? makeCustomGame(entry) : { error: 'bad' };
    if ('game' in made && !customs.some((game) => game.id === made.game.id)) customs.push(made.game);
  }
  writeSetting('customGames', customs);

  let added = 0;
  for (const entry of data.results) {
    const game = findGame(entry?.gameId);
    if (!game || !isDateString(entry.date) || getResult(entry.gameId, entry.date)) continue;
    const clean = cleanResult(game, entry);
    if (!clean) continue;
    const key = keyOf(entry.gameId, entry.date);
    const row = {
      key, gameId: entry.gameId, date: entry.date, ...clean, source: 'backup', updatedAt: Date.now(), synced: false, deleted: false,
    };
    results.set(key, row);
    persist(row);
    added += 1;
  }

  const ids = Array.isArray(data.games) ? data.games.filter((id) => typeof id === 'string' && findGame(id)) : [];
  const merged = [...myGames().map((game) => game.id), ...ids];
  writeSetting('games', [...new Set(merged)]);
  changed();
  return { added };
}
