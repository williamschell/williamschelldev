// Word counting and the rules for what can be posted. The limits here must match the
// checks on public.posts in supabase/schema.sql.

/** Fewest words a posted story can have. */
export const MIN_WORDS = 10;

/** No day's limit can be higher than this. */
export const MAX_WORD_LIMIT = 5000;

/** A backstop against one enormous "word". Far more than 5,000 real words need. */
export const MAX_STORY_CHARS = 50000;

const WORDS_PER_MINUTE = 220;

/**
 * Counts runs of non-space characters, the same definition the database uses.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  return (String(text).match(/\S+/g) ?? []).length;
}

/**
 * @param {number} words
 * @returns {string} e.g. "4 min read"
 */
export function readingTime(words) {
  return `${Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))} min read`;
}

/**
 * Why a story can't be posted yet.
 * @param {string} body
 * @param {number} wordLimit
 * @returns {string|null} a message, or null if it can be posted
 */
export function postProblem(body, wordLimit) {
  const words = countWords(body);
  if (words < MIN_WORDS) return `Posting takes at least ${MIN_WORDS} words.`;
  if (words > wordLimit) {
    const over = words - wordLimit;
    return `${over.toLocaleString()} ${over === 1 ? 'word' : 'words'} over the limit. Trim to post. Saving still works.`;
  }
  if (body.trim().length > MAX_STORY_CHARS) return 'This story has too many characters to post.';
  return null;
}
