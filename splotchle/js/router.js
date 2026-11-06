// Hash routes. They survive refreshes and need no 404 tricks on GitHub Pages.

const ROUTES = ['draw', 'today', 'all-time', 'unlimiteds', 'mine', 'rules'];

/**
 * @typedef {object} Route
 * @property {string} name
 * @property {Record<string, string>} params
 */

/**
 * Parses a location.hash value. Anything unknown goes to the draw view.
 * @param {string} hash
 * @returns {Route}
 */
export function parseHash(hash) {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'post' && parts.length === 2) {
    return { name: 'post', params: { id: decodeURIComponent(parts[1]) } };
  }
  if (parts.length === 1 && ROUTES.includes(parts[0])) return { name: parts[0], params: {} };
  return { name: 'draw', params: {} };
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
