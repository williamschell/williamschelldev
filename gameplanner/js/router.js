// Hash routes. They survive refreshes and need no 404 tricks on GitHub Pages.

import { DISCIPLINES } from './model.js';

export const ROUTES = ['gdd', 'todos', 'export', 'games'];

/**
 * @typedef {object} Route
 * @property {string} name
 * @property {Record<string, string>} params
 */

/**
 * Parses a location.hash value. Anything unknown goes to the design doc.
 * @param {string} hash
 * @returns {Route}
 */
export function parseHash(hash) {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'todos' && parts.length === 2 && DISCIPLINES.some((d) => d.id === parts[1])) {
    return { name: 'todos', params: { discipline: parts[1] } };
  }
  if (parts.length === 1 && ROUTES.includes(parts[0])) return { name: parts[0], params: {} };
  return { name: 'gdd', params: {} };
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
