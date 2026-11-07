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
  23514: 'That name isn\'t allowed. Try a different one.',
};

/**
 * @param {unknown} err
 * @returns {string} something a person can read
 */
export function friendlyError(err) {
  return MESSAGES[err?.code] ?? 'Couldn\'t reach the server. Check your connection and try again.';
}
