// Every Supabase call lives here. The client library loads on demand, so it adds nothing to
// the first load, and the rest of the app works without it. demo.js has the same exports.

import { SUPABASE, BACKEND_CONFIGURED } from './config.js';

const ADJECTIVES = ['Wobbly', 'Squishy', 'Sleepy', 'Lumpy', 'Gentle', 'Curious', 'Bouncy', 'Soggy', 'Fuzzy', 'Tiny', 'Grumpy', 'Jolly'];
const ANIMALS = ['Newt', 'Otter', 'Moth', 'Toad', 'Crab', 'Heron', 'Slug', 'Vole', 'Goose', 'Lemur', 'Tapir', 'Snail'];

/** Whether a backend is set up for this environment. */
export const isConfigured = BACKEND_CONFIGURED;

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

// supabase-js keeps its session under this key. Checking it first means that someone who never
// joined doesn't download the 250 KB client on every visit. The key includes the project, so a
// session from Splotchle or Novle on this same origin doesn't count.
function sessionKey() {
  return `sb-${new URL(SUPABASE.url).hostname.split('.')[0]}-auth-token`;
}

async function hasSession() {
  if (!isConfigured) return false;
  try {
    if (localStorage.getItem(sessionKey()) === null) return false;
  } catch {
    return false;
  }
  const client = await getClient();
  const { data } = await client.auth.getSession();
  return Boolean(data.session);
}

/** @returns {string} a name like "Wobbly Newt 482" */
export function randomDisplayName() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${Math.floor(Math.random() * 900) + 100}`;
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
 * The current player, without signing anyone in.
 * @returns {Promise<{ name: string, publicBoard: boolean, code: string }|null>} null if they haven't joined
 */
export async function getAccount() {
  if (!await hasSession()) return null;
  const rows = await rpc('my_account');
  if (rows.length === 0) return null;
  return { name: rows[0].display_name, publicBoard: rows[0].public_board, code: rows[0].friend_code };
}

/**
 * Starts comparing: signs in anonymously if needed, and creates the player.
 * @param {string} name
 * @param {boolean} publicBoard
 * @returns {Promise<void>}
 */
export async function join(name, publicBoard) {
  const client = await getClient();
  if (!await hasSession()) {
    const { error } = await client.auth.signInAnonymously();
    if (error) throw error;
  }
  await rpc('save_profile', { p_name: name, p_public: publicBoard });
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

/** Deletes everything on the server for this player and signs out. */
export async function leave() {
  await rpc('delete_my_data');
  const client = await getClient();
  await client.auth.signOut();
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
 * @param {{ gameId: string, date: string, score: number|null, failed: boolean }[]} rows
 * @returns {Promise<void>}
 */
export async function saveResults(rows) {
  await rpc('save_results', {
    p_rows: rows.map((r) => ({
      game_id: r.gameId, play_date: r.date, score: r.score, failed: r.failed,
    })),
  });
}

/**
 * @param {string} gameId
 * @param {string} date
 * @returns {Promise<void>}
 */
export async function deleteResult(gameId, date) {
  await rpc('delete_result', { p_game: gameId, p_date: date });
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
