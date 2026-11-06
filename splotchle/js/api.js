// Every Supabase call lives here. The client library loads on demand, so it adds nothing
// to the first load and the rest of the app never depends on it.

import { SUPABASE, GALLERY_CONFIGURED } from './config.js';

export const PAGE_SIZE = 24;

const BUCKET = 'posts';
const POST_COLUMNS = 'id,user_id,daily_date,seed,params,gen_version,transform,blob_style,image_path,thumb_path,'
  + 'like_count,hidden,created_at,profiles(display_name)';

const ADJECTIVES = ['Wobbly', 'Squishy', 'Sleepy', 'Lumpy', 'Gentle', 'Curious', 'Bouncy', 'Soggy', 'Fuzzy', 'Tiny', 'Grumpy', 'Jolly'];
const ANIMALS = ['Newt', 'Otter', 'Moth', 'Toad', 'Crab', 'Heron', 'Slug', 'Vole', 'Goose', 'Lemur', 'Tapir', 'Snail'];

/** Whether a backend is set up for this environment. */
export const isConfigured = GALLERY_CONFIGURED;

let clientPromise = null;

function getClient() {
  if (!isConfigured) return Promise.reject(new Error('Gallery is not configured'));
  if (!clientPromise) {
    clientPromise = import('../vendor/supabase.js')
      .then(({ createClient }) => createClient(SUPABASE.url, SUPABASE.anonKey))
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** @returns {Promise<string|null>} the signed-in user's id, without signing anyone in */
export async function currentUserId() {
  if (!isConfigured) return null;
  const client = await getClient();
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Signs in anonymously if needed. Only called for actions that need an identity, so people
 * who are just browsing don't create accounts.
 * @returns {Promise<string>} user id
 */
export async function ensureUser() {
  const client = await getClient();
  const { data } = await client.auth.getSession();
  if (data.session) return data.session.user.id;
  const result = unwrap(await client.auth.signInAnonymously());
  return result.user.id;
}

/** @returns {string} a name like "Wobbly Newt 482" */
export function randomDisplayName() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${Math.floor(Math.random() * 900) + 100}`;
}

/**
 * Checks a display name's shape. The server applies the same rule and the blocklist.
 * @param {string} name
 * @returns {string|null} an error message, or null if it's fine
 */
export function displayNameError(name) {
  if (name.length < 2 || name.length > 24) return 'Names are 2 to 24 characters.';
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) return 'Use letters, numbers, spaces, _ and - only.';
  return null;
}

/** @returns {Promise<string|null>} the current user's name, if they have one */
export async function getMyName() {
  const userId = await currentUserId();
  if (!userId) return null;
  const client = await getClient();
  const row = unwrap(await client.from('profiles').select('display_name').eq('user_id', userId).maybeSingle());
  return row?.display_name ?? null;
}

/**
 * @param {string} displayName
 * @returns {Promise<void>}
 */
export async function saveMyName(displayName) {
  const userId = await ensureUser();
  const client = await getClient();
  unwrap(await client.from('profiles').upsert({ user_id: userId, display_name: displayName }));
}

/**
 * Builds a keyset filter so paging stays stable and fast while posts are being added.
 * "Past the cursor" depends on the sort order: newest first, or most liked first with ties
 * going to the earlier post.
 */
function keysetFilter(sort, cursor) {
  // Timestamps contain + and :, so they're quoted for PostgREST's or() syntax.
  const at = `"${cursor.created_at}"`;
  if (sort === 'top') {
    const n = cursor.like_count;
    return `like_count.lt.${n},and(like_count.eq.${n},created_at.gt.${at}),`
      + `and(like_count.eq.${n},created_at.eq.${at},id.gt.${cursor.id})`;
  }
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id})`;
}

/**
 * Fetches a page of posts.
 * @param {object} options
 * @param {'new'|'top'} options.sort
 * @param {string} [options.date] only this daily date
 * @param {string} [options.since] only daily dates on or after this one
 * @param {boolean} [options.unlimited] free play posts instead of daily ones
 * @param {object|null} [options.cursor] the last post of the previous page
 * @returns {Promise<{ posts: object[], hasMore: boolean }>}
 */
export async function listPosts({ sort, date, since, unlimited = false, cursor = null }) {
  const client = await getClient();
  let query = client.from('posts').select(POST_COLUMNS);
  // The two kinds never mix, so unlimited posts can't reach Today or All-Time.
  query = unlimited ? query.is('daily_date', null) : query.not('daily_date', 'is', null);
  if (date) query = query.eq('daily_date', date);
  if (since) query = query.gte('daily_date', since);
  if (cursor) query = query.or(keysetFilter(sort, cursor));
  if (sort === 'top') {
    query = query.order('like_count', { ascending: false })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
  } else {
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false });
  }
  const posts = unwrap(await query.limit(PAGE_SIZE));
  return { posts, hasMore: posts.length === PAGE_SIZE };
}

/**
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getPost(id) {
  const client = await getClient();
  return unwrap(await client.from('posts').select(POST_COLUMNS).eq('id', id).maybeSingle());
}

/**
 * @param {string} path a storage path
 * @returns {string} its public URL
 */
export function imageUrl(path) {
  if (!isConfigured) return '';
  return `${SUPABASE.url}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * @param {string[]} postIds
 * @returns {Promise<Set<string>>} which of these the current user has liked
 */
export async function getMyLikes(postIds) {
  const userId = await currentUserId();
  if (!userId || postIds.length === 0) return new Set();
  const client = await getClient();
  const rows = unwrap(await client.from('likes').select('post_id').eq('user_id', userId).in('post_id', postIds));
  return new Set(rows.map((r) => r.post_id));
}

/**
 * @param {string[]} postIds
 * @returns {Promise<Map<string, number>>} current like counts
 */
export async function getLikeCounts(postIds) {
  if (postIds.length === 0) return new Map();
  const client = await getClient();
  const rows = unwrap(await client.from('posts').select('id,like_count').in('id', postIds));
  return new Map(rows.map((r) => [r.id, r.like_count]));
}

/**
 * @param {string} postId
 * @param {boolean} liked
 * @returns {Promise<void>}
 */
export async function setLike(postId, liked) {
  const userId = await ensureUser();
  const client = await getClient();
  if (liked) {
    const { error } = await client.from('likes').insert({ post_id: postId, user_id: userId });
    // 23505 means it's already liked, which is the state we wanted anyway.
    if (error && error.code !== '23505') throw error;
  } else {
    unwrap(await client.from('likes').delete().eq('post_id', postId).eq('user_id', userId));
  }
}

/**
 * @param {string} postId
 * @param {string} reason
 * @returns {Promise<void>}
 */
export async function reportPost(postId, reason) {
  const userId = await ensureUser();
  const client = await getClient();
  const { error } = await client.from('reports').insert({ post_id: postId, user_id: userId, reason });
  // Reporting the same post twice just keeps the first report.
  if (error && error.code !== '23505') throw error;
}

const extensionFor = (blob) => (blob.type === 'image/webp' ? 'webp' : 'png');

/**
 * Uploads the images and creates the post. If the insert fails, the uploads are removed so
 * nothing is left orphaned in storage.
 * @param {object} post
 * @param {string|null} post.dailyDate null for an unlimited post
 * @param {string} [post.seed] an unlimited post's blob seed
 * @param {object} [post.params] an unlimited post's blob params
 * @param {number} post.genVersion
 * @param {object} post.transform
 * @param {object} post.blobStyle
 * @param {Blob} post.image
 * @param {Blob} post.thumb
 * @returns {Promise<string>} the new post's id
 */
export async function createPost({
  dailyDate, seed = null, params = null, genVersion, transform, blobStyle, image, thumb,
}) {
  const userId = await ensureUser();
  const client = await getClient();
  const storage = client.storage.from(BUCKET);
  const name = crypto.randomUUID();
  // Storage only accepts folders named for a current date. UTC is always inside that window.
  const folder = dailyDate ?? new Date().toISOString().slice(0, 10);
  const imagePath = `${userId}/${folder}/${name}.${extensionFor(image)}`;
  const thumbPath = `${userId}/${folder}/${name}-thumb.${extensionFor(thumb)}`;

  unwrap(await storage.upload(imagePath, image, { contentType: image.type, cacheControl: '31536000' }));
  try {
    unwrap(await storage.upload(thumbPath, thumb, { contentType: thumb.type, cacheControl: '31536000' }));
    const row = unwrap(await client.from('posts').insert({
      user_id: userId,
      daily_date: dailyDate,
      seed,
      params,
      gen_version: genVersion,
      transform,
      blob_style: blobStyle,
      image_path: imagePath,
      thumb_path: thumbPath,
    }).select('id').single());
    return row.id;
  } catch (err) {
    await storage.remove([imagePath, thumbPath]);
    throw err;
  }
}

/**
 * Deletes one of the current user's posts, and then its images.
 * @param {object} post
 * @returns {Promise<void>}
 */
export async function deletePost(post) {
  const client = await getClient();
  unwrap(await client.from('posts').delete().eq('id', post.id));
  await client.storage.from(BUCKET).remove([post.image_path, post.thumb_path]);
}
