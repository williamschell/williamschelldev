// Hash routes. They survive refreshes and need no 404 tricks on GitHub Pages.

const ROUTES = ['today', 'compare', 'streaks', 'friends', 'games', 'account'];

/**
 * @typedef {object} Route
 * @property {string} name
 * @property {Record<string, string>} params
 */

/**
 * Parses a location.hash value. Anything unknown goes to Today.
 * @param {string} hash
 * @returns {Route}
 */
export function parseHash(hash) {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'add' && parts.length === 2) {
    return { name: 'friends', params: { code: decodeURIComponent(parts[1]) } };
  }
  // Signing in from an invite link, which then goes on to add the friend.
  if (parts[0] === 'account' && parts[1] === 'add' && parts.length === 3) {
    return { name: 'account', params: { code: decodeURIComponent(parts[2]) } };
  }
  if (parts[0] === 'compare' && parts.length === 2) {
    return { name: 'compare', params: { game: decodeURIComponent(parts[1]) } };
  }
  if (parts.length === 1 && ROUTES.includes(parts[0])) return { name: parts[0], params: {} };
  return { name: 'today', params: {} };
}

/**
 * Calls onChange now and on every later hash change.
 * @param {(route: Route) => void} onChange
 */
export function startRouter(onChange) {
  const fire = () => onChange(parseHash(window.location.hash));
  window.addEventListener('hashchange', fire);
  fire();
}
