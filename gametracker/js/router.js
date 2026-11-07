// Hash routes. They survive refreshes and need no 404 tricks on GitHub Pages.

const ROUTES = ['today', 'compare', 'streaks', 'friends', 'games'];

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
