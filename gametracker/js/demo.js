// A fake backend for ?demo, with the same exports as api.js. The players are made up, and a
// banner says so on every page. Their scores come from a hash of the player, game and date, so
// they stay put between visits.

import { addDays } from './dates.js';
import { catalogGame } from './catalog.js';
import { rankRows } from './scores.js';
import { displayNameError, passwordError, usernameError } from './api.js';

export { displayNameError, passwordError, usernameError };

export const isConfigured = true;

const KEY = 'gametracker-demo:account';
const ME = 'demo-me';

const FRIENDS = ['Sample Sam', 'Example Alex', 'Pretend Priya'];
const STRANGERS = ['Made Up Mo', 'Fictional Finn', 'Invented Ines', 'Placeholder Pat', 'Mock Mina', 'Dummy Dev'];
const toId = (name) => `demo-${name.toLowerCase().replace(/ /g, '-')}`;

const savedResults = new Map();
const wait = () => new Promise((resolve) => { setTimeout(resolve, 60); });

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function loadAccount() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function saveAccount(account) {
  localStorage.setItem(KEY, JSON.stringify(account));
}

/** A fake player's result, or null if they skipped this game that day. */
function fakeResult(name, game, date) {
  const roll = hash(`${name}|${game.id}|${date}`);
  if (roll % 5 === 0) return null;
  const n = roll >>> 8;
  switch (game.kind) {
    case 'guesses': {
      const max = game.max ?? 6;
      const failed = n % 12 === 0;
      return { score: failed ? null : 2 + (n % (max - 1)), failed };
    }
    case 'count': return { score: n % 6, failed: false };
    case 'time': return { score: 25 + (n % 200), failed: false };
    case 'points': return { score: game.max ? 1 + (n % game.max) : 40 + (n % 200), failed: false };
    default: return { score: null, failed: false };
  }
}

/** How many days in a row this fake player had played, counting back from this date. */
function fakeStreak(name, game, date) {
  let streak = 0;
  while (streak < 60 && fakeResult(name, game, addDays(date, -streak))) streak += 1;
  return streak;
}

/** @returns {{ username: string }|null} */
export function signedInAs() {
  const account = loadAccount();
  return account?.username ? { username: account.username } : null;
}

export async function isSignedIn() {
  return signedInAs() !== null;
}

export async function getAccount() {
  const account = loadAccount();
  return account?.username ? {
    username: account.username, name: account.name, publicBoard: account.publicBoard, code: account.code,
  } : null;
}

// Any username and password work in the demo, and every account starts with the same friends.
async function demoSignIn(username, publicBoard) {
  await wait();
  const clean = username.trim().toLowerCase();
  saveAccount({
    username: clean, name: clean, publicBoard, code: 'DE3040C0DE', friends: FRIENDS.map((n) => ({ user_id: toId(n), display_name: n })),
  });
}

export const signUp = (username, password, publicBoard) => demoSignIn(username, publicBoard);
export const signIn = (username) => demoSignIn(username, true);

export async function signOut() {
  localStorage.removeItem(KEY);
  savedResults.clear();
}

export async function changePassword() {
  await wait();
}

export const deleteAccount = signOut;

export async function myResults() {
  return [];
}

export async function saveList() {
  return new Date().toISOString();
}

export async function myList() {
  return null;
}

export async function updateAccount(name, publicBoard) {
  saveAccount({ ...loadAccount(), name, publicBoard });
}

export async function rotateCode() {
  const code = Math.floor(Math.random() * 0xffffffffff).toString(16).toUpperCase().padStart(10, '0');
  saveAccount({ ...loadAccount(), code });
  return code;
}

export async function addFriend(code) {
  await wait();
  if (!/^[0-9A-Fa-f]{10}$/.test(code.trim())) throw Object.assign(new Error('Unknown code'), { code: 'P0404' });
  const account = loadAccount();
  const name = `Demo Friend ${code.trim().slice(0, 4).toUpperCase()}`;
  if (!account.friends.some((f) => f.display_name === name)) {
    account.friends.push({ user_id: toId(name), display_name: name });
    saveAccount(account);
  }
  return name;
}

export async function removeFriend(userId) {
  const account = loadAccount();
  account.friends = account.friends.filter((f) => f.user_id !== userId);
  saveAccount(account);
}

export async function listFriends() {
  await wait();
  return [...(loadAccount()?.friends ?? [])].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export async function saveResults(rows) {
  for (const row of rows) {
    if (row.deleted) savedResults.delete(`${row.gameId}|${row.date}`);
    else savedResults.set(`${row.gameId}|${row.date}`, row);
  }
}

/** Works for any game the player might view, including custom ones. */
const fakeRows = (game, date, names) => names.flatMap((name) => {
  const result = fakeResult(name, game, date);
  return result ? [{ user_id: toId(name), display_name: name, ...result }] : [];
});

export async function gameBoard({ game, date, scope }) {
  await wait();
  const account = loadAccount();
  const friends = (account?.friends ?? []).map((f) => f.display_name);
  const names = scope === 'friends' ? friends : [...new Set([...friends, ...STRANGERS])];
  const rows = fakeRows(game, date, names).map((row) => ({
    ...row, is_me: false, is_friend: friends.includes(row.display_name), streak: fakeStreak(row.display_name, game, date),
  }));
  const mine = savedResults.get(`${game.id}|${date}`);
  if (account && mine) {
    rows.push({
      user_id: ME, display_name: account.name, score: mine.score, failed: mine.failed, is_me: true, is_friend: false, streak: 1,
    });
  }
  return rankRows(game, rows);
}

const DEMO_GAMES = ['splotchle', 'krillion', 'enclose-horse', 'farflung', 'novle', 'wordle', 'connections', 'strands', 'mini', 'worldle', 'quordle', 'framed', 'contexto'];

export async function dayBoard({ date, scope }) {
  await wait();
  const account = loadAccount();
  const friends = (account?.friends ?? []).map((f) => f.display_name);
  const names = scope === 'friends' ? friends : [...new Set([...friends, ...STRANGERS])];
  const rows = DEMO_GAMES.flatMap((id) => fakeRows(catalogGame(id), date, names).map((row) => ({
    ...row, game_id: id, is_me: false, is_friend: friends.includes(row.display_name),
  })));
  if (account) {
    for (const mine of savedResults.values()) {
      if (mine.date !== date || mine.gameId.startsWith('c-')) continue;
      rows.push({
        user_id: ME, display_name: account.name, game_id: mine.gameId, score: mine.score, failed: mine.failed, is_me: true, is_friend: false,
      });
    }
  }
  return rows;
}

export async function friendsDay(date) {
  await wait();
  const friends = loadAccount()?.friends ?? [];
  return DEMO_GAMES.flatMap((id) => {
    const game = catalogGame(id);
    return fakeRows(game, date, friends.map((f) => f.display_name)).map((row) => ({ ...row, game_id: id }));
  });
}
