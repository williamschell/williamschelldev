// Every Supabase call lives here. The client library loads on demand, so it adds nothing to
// the first load, and the rest of the app works without it. demo.js has the same exports.
//
// Accounts are a username and password kept in our own database (see the 2026-11-07
// migration in schema.sql). Each browser has an anonymous Supabase session that's only a
// device id, and signing in links it to an account.

import { SUPABASE, BACKEND_CONFIGURED } from './config.js';

/** Whether a backend is set up for this environment. */
export const isConfigured = BACKEND_CONFIGURED;

// Remembers which account this browser is signed in to, so someone who isn't signed in never
// downloads the 250 KB client, and the app can say who's signed in without a request.
const ACCOUNT_KEY = 'gametracker:account';

let clientPromise = null;

function getClient() {
  if (!isConfigured) return Promise.reject(new Error('Backend is not configured'));
  if (!clientPromise) {
    clientPromise = import('../vendor/supabase.js')
      .then(({ createClient }) => createClient(SUPABASE.url, SUPABASE.anonKey))
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

async function rpc(name, args = {}) {
  const client = await getClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

/** @returns {{ username: string }|null} the account this browser last signed in to */
export function signedInAs() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNT_KEY));
    return typeof saved?.username === 'string' ? saved : null;
  } catch {
    return null;
  }
}

function remember(username) {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ username }));
  } catch { /* the session still works for this visit */ }
}

function forget() {
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch { /* nothing to do */ }
}

/** Gets this browser's device session, making one the first time. */
async function deviceSession() {
  const client = await getClient();
  const { data } = await client.auth.getSession();
  if (data.session) return;
  const { error } = await client.auth.signInAnonymously();
  if (error) throw error;
}

/**
 * Whether this browser is signed in, as far as it knows. Cheap: no request.
 * @returns {Promise<boolean>}
 */
export async function isSignedIn() {
  return isConfigured && signedInAs() !== null;
}

/**
 * Checks a username's shape. The server applies the same rule, plus the name blocklist.
 * @param {string} username
 * @returns {string|null} an error message, or null if it's fine
 */
export function usernameError(username) {
  if (username.length < 3 || username.length > 20) return 'Usernames are 3 to 20 characters.';
  if (!/^[a-z0-9_]+$/i.test(username)) return 'Use letters, numbers and _ only in a username.';
  return null;
}

/**
 * @param {string} password
 * @returns {string|null} an error message, or null if it's fine
 */
export function passwordError(password) {
  if (password.length < 8) return 'Passwords need at least 8 characters.';
  if (new TextEncoder().encode(password).length > 72) return 'That password is too long.';
  return null;
}

/**
 * Checks a display name's shape. The server applies the same rule and the blocklist.
 * @param {string} name
 * @returns {string|null} an error message, or null if it's fine
 */
export function displayNameError(name) {
  if (name.length < 2 || name.length > 24) return 'Names are 2 to 24 characters.';
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) return 'Use letters, numbers, spaces, _ and - only.';
  return null;
}

/**
 * The signed-in account. If the server no longer recognizes this browser, for example after
 * the password was changed on another device, it counts as signed out.
 * @returns {Promise<{ username: string, name: string, publicBoard: boolean, code: string }|null>}
 */
export async function getAccount() {
  if (!await isSignedIn()) return null;
  const client = await getClient();
  const { data } = await client.auth.getSession();
  if (!data.session) {
    forget();
    return null;
  }
  const rows = await rpc('my_account');
  if (rows.length === 0) {
    forget();
    return null;
  }
  const [row] = rows;
  if (row.username !== signedInAs()?.username) remember(row.username);
  return {
    username: row.username, name: row.display_name, publicBoard: row.public_board, code: row.friend_code,
  };
}

/**
 * @param {string} username
 * @param {string} password
 * @param {boolean} publicBoard
 * @returns {Promise<void>}
 */
export async function signUp(username, password, publicBoard) {
  await deviceSession();
  await rpc('sign_up', { p_username: username, p_password: password, p_public: publicBoard });
  remember(username.trim().toLowerCase());
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<void>}
 */
export async function signIn(username, password) {
  await deviceSession();
  const outcome = await rpc('sign_in', { p_username: username, p_password: password });
  if (outcome === 'locked') throw Object.assign(new Error('Locked'), { code: 'LOCKED' });
  if (outcome !== 'ok') throw Object.assign(new Error('Bad login'), { code: 'BAD_LOGIN' });
  remember(username.trim().toLowerCase());
}

/**
 * Signs this browser out. The device session stays, ready for the next sign-in. If the server
 * can't be told, for example when offline, the browser drops its session instead, so nobody
 * using this browser afterwards can act as the account.
 */
export async function signOut() {
  forget();
  try {
    await rpc('sign_out');
  } catch (err) {
    const client = await getClient();
    await client.auth.signOut({ scope: 'local' });
    throw err;
  }
}

/**
 * Also signs out every other device.
 * @param {string} oldPassword
 * @param {string} newPassword
 * @returns {Promise<void>}
 */
export async function changePassword(oldPassword, newPassword) {
  const ok = await rpc('change_password', { p_old: oldPassword, p_new: newPassword });
  if (!ok) throw Object.assign(new Error('Bad login'), { code: 'BAD_PASSWORD' });
}

/** Deletes the account and everything in it from the server. */
export async function deleteAccount() {
  await rpc('delete_my_account');
  forget();
}

/**
 * @param {string} name
 * @param {boolean} publicBoard
 * @returns {Promise<void>}
 */
export async function updateAccount(name, publicBoard) {
  await rpc('save_profile', { p_name: name, p_public: publicBoard });
}

/** @returns {Promise<string>} the new friend code */
export function rotateCode() {
  return rpc('rotate_friend_code');
}

/**
 * @param {string} code
 * @returns {Promise<string>} the friend's display name
 */
export async function addFriend(code) {
  const name = await rpc('add_friend', { p_code: code });
  if (name === null) throw Object.assign(new Error('Unknown code'), { code: 'P0404' });
  return name;
}

/**
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function removeFriend(userId) {
  await rpc('remove_friend', { p_user: userId });
}

/** @returns {Promise<{ user_id: string, display_name: string }[]>} */
export function listFriends() {
  return rpc('list_friends');
}

/**
 * Saves results, including tombstones for cleared ones.
 * @param {{ gameId: string, date: string, score: number|null, failed: boolean, deleted?: boolean }[]} rows
 * @returns {Promise<void>}
 */
export async function saveResults(rows) {
  await rpc('save_results', {
    p_rows: rows.map((r) => ({
      game_id: r.gameId, play_date: r.date, score: r.score, failed: r.failed, deleted: Boolean(r.deleted),
    })),
  });
}

/**
 * This account's results changed since a point in time, oldest change first.
 * @param {string|null} since a server timestamp from an earlier call, or null for everything
 * @returns {Promise<{ game_id: string, play_date: string, score: number|null, failed: boolean, deleted: boolean, updated_at: string }[]>}
 */
export function myResults(since) {
  return rpc('my_results', { p_since: since });
}

/**
 * @param {string[]} games ordered ids
 * @param {object[]} customGames
 * @returns {Promise<string>} the list's new version
 */
export function saveList(games, customGames) {
  return rpc('save_list', { p_games: games, p_custom: customGames });
}

/** @returns {Promise<{ games: unknown, customGames: unknown, version: string }|null>} */
export async function myList() {
  const rows = await rpc('my_list');
  if (rows.length === 0) return null;
  return { games: rows[0].games, customGames: rows[0].custom_games, version: rows[0].updated_at };
}

/**
 * One game's board for one day, ranked by the server.
 * @param {object} options
 * @param {{ id: string, kind: string }} options.game
 * @param {string} options.date
 * @param {'friends'|'everyone'} options.scope
 * @param {boolean} options.lower whether lower scores win
 * @returns {Promise<{ rank: number, user_id: string, display_name: string, score: number|null, failed: boolean, is_me: boolean, is_friend: boolean, streak: number }[]>}
 */
export function gameBoard({ game, date, scope, lower }) {
  return rpc('game_board', {
    p_game: game.id, p_date: date, p_scope: scope, p_lower: lower,
  });
}

/**
 * @param {string} date
 * @returns {Promise<{ game_id: string, user_id: string, display_name: string, score: number|null, failed: boolean }[]>}
 */
export function friendsDay(date) {
  return rpc('friends_day', { p_date: date });
}
