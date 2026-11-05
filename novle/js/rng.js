// Seeded randomness. Everything the generator does flows from here, so the same
// seed string gives the same prompt on every browser.

/**
 * cyrb128: hashes a string into four 32-bit integers, which seed sfc32.
 * Math.imul is exact integer arithmetic, so the result never varies by engine.
 * @param {string} str
 * @returns {[number, number, number, number]}
 */
export function cyrb128(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/**
 * Short hex digest of a string. Handy for path snapshots in the tests.
 * @param {string} str
 * @returns {string}
 */
export function hashString(str) {
  return cyrb128(str).map((n) => n.toString(16).padStart(8, '0')).join('');
}

/**
 * @typedef {object} Rng
 * @property {() => number} next uniform in [0, 1)
 * @property {(a: number, b: number) => number} range uniform in [a, b)
 * @property {(a: number, b: number) => number} int uniform integer in [a, b], inclusive
 * @property {<T>(arr: T[]) => T} pick uniform element of arr
 * @property {(p: number) => boolean} chance true with probability p
 * @property {() => [number, number]} unit uniform random unit vector
 */

/**
 * Creates a sfc32 generator from a string seed.
 * @param {string} seedString
 * @returns {Rng}
 */
export function createRng(seedString) {
  let [a, b, c, d] = cyrb128(String(seedString));

  const next = () => {
    // sfc32: a small chaotic generator with a counter (d) that guarantees a long period.
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Let the state mix before the first value is used.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    // Rejection sampling instead of cos/sin of a random angle. The spec leaves
    // Math.sin and Math.cos free to differ between engines in the last bits, and
    // this generator has to match byte for byte. + - * / and sqrt are exact.
    unit: () => {
      for (;;) {
        const x = next() * 2 - 1;
        const y = next() * 2 - 1;
        const d2 = x * x + y * y;
        if (d2 > 0.0001 && d2 <= 1) {
          const len = Math.sqrt(d2);
          return [x / len, y / len];
        }
      }
    },
  };
}
