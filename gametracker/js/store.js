// The game list and results. Everything is held in memory after startup and written through
// to IndexedDB and localStorage. Nothing here throws on a storage failure: private browsing or
// a full quota shows a message, and the app carries on for this visit.

import { isDemo, getBackend } from './backend.js';
import { addDays, isDateString, localDateString } from './dates.js';
import {
  catalogGame, DEFAULT_GAMES, isWebUrl, makeCustomGame,
} from './catalog.js';
import { cleanResult } from './scores.js';
import { readExternalStreak } from './external.js';
import { computeStreak, mergeExternalStreak } from './streaks.js';

const DB_NAME = isDemo ? 'gametracker-demo' : 'gametracker';
const PREFIX = isDemo ? 'gametracker-demo:' : 'gametracker:';
const STORE = 'results';
const BACKUP_APP = 'gametracker';
// The server takes results from this date up to a day ahead, and this many per request.
const OLDEST_DATE = '2015-01-01';
const BATCH = 500;
const PULL_LIMIT = 10000;
// Checking the account for changes from other devices, at most this often.
const PULL_EVERY_MS = 20000;
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

function removeSetting(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch { /* nothing to remove */ }
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

/** The list has changed here, so the account's copy needs updating. */
function listChanged() {
  writeSetting('listDirty', true);
}

function saveList(games) {
  writeSetting('games', games.map((game) => game.id));
  listChanged();
}

const listSnapshot = () => ({ games: myGames().map((game) => game.id), customGames: customGames() });

/**
 * Replaces the list here with the account's. Custom games are rebuilt through the same rules
 * as a typed one, so a bad link can't get in even from the server.
 * @param {{ games: unknown, customGames: unknown }} remote
 */
function applyRemoteList(remote) {
  const customs = [];
  for (const entry of Array.isArray(remote.customGames) ? remote.customGames : []) {
    const made = isWebUrl(entry?.url) ? makeCustomGame(entry) : { error: 'bad' };
    if ('game' in made && !customs.some((game) => game.id === made.game.id)) customs.push(made.game);
  }
  writeSetting('customGames', customs);
  const ids = Array.isArray(remote.games) ? remote.games.filter((id) => typeof id === 'string') : [];
  writeSetting('games', [...new Set(ids)].filter((id) => findGame(id)));
}

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
  listChanged();
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

// When signed in, the account is the lasting copy and this device is a cache of it. Changes made
// here are sent up, and changes from other devices are pulled down. A change made here that
// hasn't gone up yet always beats what's on the server.

let syncTimer = null;
let syncing = null;
let lastPull = 0;
let remoteListener = () => {};

/** @param {() => void} listener hears when another device's changes have arrived */
export function onRemoteChange(listener) {
  remoteListener = listener;
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 800);
}

/** Whether the server will take this row. Anything else just stays on this device. */
function pushable(row) {
  return row.date >= OLDEST_DATE && row.date <= addDays(localDateString(), 1)
    && /^[a-z0-9-]{1,40}$/.test(row.gameId);
}

/** @returns {number} results changed here that the account doesn't have yet */
export function pendingCount() {
  return [...results.values()].filter((row) => !row.synced && pushable(row)).length;
}

async function pushResults(backend) {
  const pending = [...results.values()].filter((row) => !row.synced && pushable(row));
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    await backend.saveResults(batch);
    for (const row of batch) {
      // If it changed while the request was out, leave it marked for the next sync.
      if (results.get(row.key)?.updatedAt !== row.updatedAt) continue;
      if (row.deleted) {
        results.delete(row.key);
        unpersist(row.key);
      } else {
        const done = { ...row, synced: true, everSynced: true };
        results.set(row.key, done);
        persist(done);
      }
    }
  }
}

/**
 * Takes one result from the account.
 * @returns {boolean} whether anything here changed
 */
function mergeRemote(remote) {
  const gameId = remote?.game_id;
  const date = String(remote?.play_date ?? '').slice(0, 10);
  if (typeof gameId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(gameId) || !isDateString(date)) return false;
  const key = keyOf(gameId, date);
  const local = results.get(key);
  if (local && !local.synced) return false;

  if (remote.deleted) {
    if (!local) return false;
    results.delete(key);
    unpersist(key);
    return true;
  }
  const score = Number.isInteger(remote.score) ? remote.score : null;
  const failed = remote.failed === true;
  if (local && local.score === score && local.failed === failed) return false;
  const row = {
    key, gameId, date, score, failed, source: local?.source ?? 'account', updatedAt: Date.now(), synced: true, deleted: false, everSynced: true,
  };
  results.set(key, row);
  persist(row);
  return true;
}

async function pullResults(backend) {
  let since = readSetting('pulledAt', null);
  let changedAny = false;
  // Pages until it's caught up. The cap only matters if something is badly wrong.
  for (let page = 0; page < 20; page += 1) {
    const rows = await backend.myResults(since);
    for (const row of rows) changedAny = mergeRemote(row) || changedAny;
    const newest = rows.length > 0 ? rows[rows.length - 1].updated_at : since;
    const advanced = newest !== since;
    since = newest;
    if (rows.length < PULL_LIMIT || !advanced) break;
  }
  writeSetting('pulledAt', since);
  return changedAny;
}

/** @returns {Promise<boolean>} whether the list here changed */
async function syncList(backend, pull) {
  if (readSetting('listDirty', false)) {
    const snapshot = listSnapshot();
    const version = await backend.saveList(snapshot.games, snapshot.customGames);
    if (JSON.stringify(listSnapshot()) === JSON.stringify(snapshot)) writeSetting('listDirty', false);
    writeSetting('listVersion', version);
    return false;
  }
  if (!pull) return false;
  const remote = await backend.myList();
  if (!remote || remote.version === readSetting('listVersion', null)) return false;
  applyRemoteList(remote);
  writeSetting('listVersion', remote.version);
  return true;
}

async function runSync(pull) {
  const backend = await getBackend();
  if (!backend.isConfigured || !await backend.isSignedIn()) return;
  // A pull also checks that the account still knows this device. If it doesn't, for example
  // after a password change elsewhere, this counts as signed out and the app redraws.
  if (pull && !await backend.getAccount()) {
    remoteListener();
    return;
  }
  let changedAny = await syncList(backend, pull);
  await pushResults(backend);
  if (pull) changedAny = (await pullResults(backend)) || changedAny;
  if (changedAny) remoteListener();
}

/**
 * Sends anything the account hasn't seen, and with pull, fetches what other devices changed.
 * Does nothing when signed out. Failures are quiet, because everything stays marked and the
 * next sync tries again.
 * @param {{ pull?: boolean, force?: boolean }} [options] force pulls even if it pulled recently
 * @returns {Promise<void>}
 */
export function syncNow({ pull = false, force = false } = {}) {
  clearTimeout(syncTimer);
  const doPull = pull && (force || Date.now() - lastPull > PULL_EVERY_MS);
  if (syncing) {
    // One at a time. A pull that was asked for runs straight after the current one.
    return doPull ? syncing.then(() => syncNow({ pull, force: true })) : syncing;
  }
  if (doPull) lastPull = Date.now();
  syncing = runSync(doPull)
    .catch((err) => console.warn('Streakle sync:', err))
    .finally(() => { syncing = null; });
  return syncing;
}

/** Everything here counts as not yet sent, and tombstones go, since no account has them. */
function markAllUnsynced() {
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

function forgetSyncState() {
  for (const key of ['pulledAt', 'listVersion', 'listDirty']) removeSetting(key);
}

/**
 * Right after signing in or creating an account: what's on this device joins the account, and
 * the account's history comes down. On sign-in the account's list wins, with any games only
 * on this device added at the end.
 * @param {{ isNew: boolean }} options
 * @returns {Promise<void>}
 */
export async function joinAccount({ isNew }) {
  await syncing;
  markAllUnsynced();
  forgetSyncState();
  const backend = await getBackend();
  const remote = isNew ? null : await backend.myList();
  if (remote) {
    const localIds = readSetting('games', null);
    const localCustoms = customGames();
    applyRemoteList(remote);
    const fromAccount = JSON.stringify(listSnapshot());
    // A list that was never changed here is just the defaults, so it adds nothing.
    if (Array.isArray(localIds)) {
      const customs = customGames();
      for (const game of localCustoms) if (!customs.some((c) => c.id === game.id)) customs.push(game);
      writeSetting('customGames', customs);
      writeSetting('games', [...new Set([...readSetting('games', []), ...localIds])].filter((id) => findGame(id)));
    }
    writeSetting('listVersion', remote.version);
    if (JSON.stringify(listSnapshot()) !== fromAccount) listChanged();
  } else {
    listChanged();
  }
  await syncNow({ pull: true, force: true });
}

/** After signing out: the account has everything, so this device starts fresh. */
export async function clearLocalData() {
  clearTimeout(syncTimer);
  await syncing;
  results.clear();
  try {
    await dbRun('readwrite', (s) => s.clear());
  } catch (err) {
    console.warn('Streakle storage:', err);
  }
  for (const key of ['games', 'customGames', 'compareGame']) removeSetting(key);
  forgetSyncState();
}

/** After deleting the account: history stays here, unsent, as if it had never been signed in. */
export async function leaveAccount() {
  await syncing;
  markAllUnsynced();
  forgetSyncState();
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
  listChanged();
  changed();
  return { added };
}
