// Picks the backend. ?demo gets made-up players and its own local data, so the social views
// can be seen with no Supabase project and real data is never touched.

export const isDemo = new URLSearchParams(window.location.search).has('demo');

let backendPromise = null;

/**
 * Both backends expose the same functions, so views don't care which one they have.
 * @returns {Promise<typeof import('./api.js')>}
 */
export function getBackend() {
  if (!backendPromise) backendPromise = isDemo ? import('./demo.js') : import('./api.js');
  return backendPromise;
}

const MESSAGES = {
  P0429: 'Slow down a little and try again in a minute.',
  P0404: 'That code doesn\'t match anyone. Check it and try again.',
  P0400: 'That\'s your own code.',
  P0413: 'You\'ve reached the limit of 100 friends.',
  P0409: 'That username is taken. Try another one.',
  23505: 'That username is taken. Try another one.',
  P0422: 'Usernames are 3 to 20 letters, numbers or _.',
  P0423: 'Passwords need at least 8 characters.',
  P0401: 'You\'re signed out. Sign in again on the Account page.',
  BAD_LOGIN: 'That username and password don\'t match.',
  BAD_PASSWORD: 'Your current password isn\'t right.',
  LOCKED: 'Too many wrong passwords. That account is locked for 15 minutes.',
  23514: 'That name isn\'t allowed. Try a different one.',
};

/**
 * @param {unknown} err
 * @returns {string} something a person can read
 */
export function friendlyError(err) {
  return MESSAGES[err?.code] ?? 'Couldn\'t reach the server. Check your connection and try again.';
}
