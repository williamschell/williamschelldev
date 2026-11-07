// Reads a game's share text into a result. These work from the formats the games are known
// to use, and share text changes now and then, so each one is deliberately loose about
// everything but the score. Manual entry is always the fallback.

const toTime = (m, s) => Number(m) * 60 + Number(s);

/** "3/6" or "X/6", the most common format. */
const outOf = (pattern) => (text) => {
  const m = text.match(pattern);
  if (!m) return null;
  const failed = m[1].toUpperCase() === 'X';
  return { score: failed ? null : Number(m[1]), failed };
};

const clock = (pattern) => (text) => {
  const m = text.match(pattern);
  return m ? { score: toTime(m[1], m[2]), failed: false } : null;
};

const guessCount = (pattern) => (text) => {
  const m = text.match(pattern);
  return m ? { score: Number(m[1]), failed: false } : null;
};

function connections(text) {
  if (!/Connections\s*(?:\r?\n)?\s*Puzzle\s*#?\s*\d+/i.test(text)) return null;
  const rows = text.split(/\r?\n/)
    .map((line) => [...line].filter((ch) => '🟨🟩🟦🟪'.includes(ch)))
    .filter((cells) => cells.length === 4);
  if (rows.length === 0) return null;
  const solved = rows.filter((cells) => new Set(cells).size === 1).length;
  return { score: rows.length - solved, failed: solved < 4 };
}

function strands(text) {
  if (!/Strands\s*#?\s*\d+/i.test(text)) return null;
  return { score: [...text].filter((ch) => ch === '💡').length, failed: false };
}

function framed(text) {
  if (!/Framed\s*#?\s*\d+/i.test(text)) return null;
  const line = text.split(/\r?\n/).find((l) => /[🟥🟩⬛]/u.test(l));
  if (!line) return null;
  const cells = [...line].filter((ch) => '🟥🟩⬛'.includes(ch));
  const hit = cells.indexOf('🟩');
  return hit === -1 ? { score: null, failed: true } : { score: hit + 1, failed: false };
}

function quordle(text) {
  if (!/Quordle\s+\d+/i.test(text)) return null;
  const digits = [...text.matchAll(/([1-9])️?⃣/g)].map((m) => Number(m[1]));
  const misses = [...text].filter((ch) => ch === '🟥').length;
  if (digits.length + misses === 0) return null;
  return { score: digits.reduce((a, b) => a + b, 0), failed: misses > 0 };
}

function waffle(text) {
  const m = text.match(/#waffle\s*\d+\s+([0-5X])\/5/i);
  if (!m) return null;
  const failed = m[1].toUpperCase() === 'X';
  return { score: failed ? null : Number(m[1]), failed };
}

function globle(text) {
  if (!/globle/i.test(text)) return null;
  const m = text.match(/=\s*(\d+)/);
  return m ? { score: Number(m[1]), failed: false } : null;
}

/** Tried in order. Each name below is specific enough that the order rarely matters. */
const PARSERS = [
  ['wordle', outOf(/\bWordle\s+[\d,.\s]*?\d\s+([1-6X])\/6/i)],
  ['worldle', outOf(/\bWorldle\s+#?\s*\d+[^\n]*?\b([1-6X])\/6/i)],
  ['connections', connections],
  ['strands', strands],
  ['mini', clock(/Mini Crossword in (\d+):(\d{2})/i)],
  ['framed', framed],
  ['contexto', guessCount(/contexto\.me\s+#?\s*\d+[\s\S]*?(\d+)\s+(?:guess|tent|intent)/i)],
  ['semantle', guessCount(/Semantle\s+#?\s*\d+[\s\S]*?(\d+)\s+guess/i)],
  ['quordle', quordle],
  ['waffle', waffle],
  ['nerdle', outOf(/nerdlegame\s+\d+\s+([1-6X])\/6/i)],
  ['bandle', outOf(/Bandle\s+#?\s*\d+\s+([1-6X])\/6/i)],
  ['costcodle', outOf(/Costcodle\s+#?\s*\d+\s+([1-6X])\/6/i)],
  ['queens', clock(/Queens\s+#?\s*\d+\s*\|?\s*(\d+):(\d{2})/i)],
  ['tango', clock(/Tango\s+#?\s*\d+\s*\|?\s*(\d+):(\d{2})/i)],
  ['globle', globle],
];

/**
 * @param {string} text anything someone pasted
 * @returns {{ gameId: string, score: number|null, failed: boolean }|null} null if it isn't recognized
 */
export function parseShare(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  for (const [gameId, parser] of PARSERS) {
    const result = parser(text);
    if (result) return { gameId, ...result };
  }
  return null;
}
