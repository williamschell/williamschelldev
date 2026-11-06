// The public gallery views: Today, All-Time, Unlimiteds and single posts, plus the posting flow.
// The api module is passed in, which lets tests/gallery-preview.html run on fake data.

import {
  generateBlob, colorForSeed, BLOB_COLORS, ARTBOARD, GEN_VERSION,
} from './blob.js';
import { composeMatrix, normalizeTransform, toSvgMatrix } from './transform.js';
import {
  localDateString, dailySeed, dailyParams, challengeNumber, daysBetween,
} from './daily.js';
import {
  renderPanel, renderDrawing, encodeUnderLimit, GHOST_OPACITY, OUTLINE_WIDTH,
} from './export.js';
import { readSetting, writeSetting } from './storage.js';
import {
  el, icon, toast, openDialog, confirmDialog, formatDate,
} from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_IMAGE_BYTES = 400 * 1024;
const MAX_THUMB_BYTES = 80 * 1024;
const IMAGE_SIZE = 1024;
const THUMB_SIZE = 384;
const LIKE_DEBOUNCE_MS = 300;
const PATH_CACHE_LIMIT = 500;

/** Generated blob paths, since a page of daily posts shares one and scrolling revisits them. */
const pathCache = new Map();

/**
 * A blob's path. It's generated rather than downloaded, which also proves which blob the art
 * was drawn on. generateBlob clamps params, so other people's posts can't ask for anything
 * outside the normal range.
 * @returns {string|null} null if this client can't generate it, such as an unknown version
 */
function cachedPath(seed, params, genVersion) {
  const key = `${genVersion}:${JSON.stringify(params)}:${seed}`;
  if (!pathCache.has(key)) {
    // Unlimited posts each have their own blob, so an endless scroll could otherwise keep them all.
    if (pathCache.size >= PATH_CACHE_LIMIT) pathCache.clear();
    try {
      pathCache.set(key, generateBlob({ seed, params, genVersion }).pathData);
    } catch {
      pathCache.set(key, null);
    }
  }
  return pathCache.get(key);
}

const dailyPath = (date, genVersion) => cachedPath(dailySeed(date), dailyParams(date), genVersion);

/** The path of the blob a post was drawn on, whichever kind of post it is. */
const postPath = (post) => (post.daily_date
  ? dailyPath(post.daily_date, post.gen_version)
  : cachedPath(post.seed, post.params, post.gen_version));

/** Style data comes from other people's posts, so only accept known shapes. */
function safeStyle(style) {
  const color = /^#[0-9a-f]{6}$/i.test(style?.color ?? '') ? style.color : BLOB_COLORS[0];
  const mode = ['fill', 'outline', 'ghost'].includes(style?.mode) ? style.mode : 'fill';
  return { color, mode };
}

/** Builds a blob as an SVG element. */
function blobSvg(pathData, transform, style) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ARTBOARD} ${ARTBOARD}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'The blob');
  if (!pathData) return svg;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', toSvgMatrix(composeMatrix(normalizeTransform(transform), ARTBOARD)));
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill-rule', 'evenodd');
  const { color, mode } = safeStyle(style);
  path.setAttribute('fill', mode === 'outline' ? 'none' : color);
  if (mode === 'ghost') path.setAttribute('fill-opacity', GHOST_OPACITY);
  if (mode === 'outline') {
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', OUTLINE_WIDTH);
  }
  g.append(path);
  svg.append(g);
  return svg;
}

const nameOf = (post) => post.profiles?.display_name ?? 'Anonymous';

/** The local date a post went up. Unlimited posts have no daily date to show instead. */
const postedOn = (post) => formatDate(localDateString(new Date(post.created_at)));

/** The date N days before a YYYY-MM-DD date. */
function daysBefore(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const when = new Date(y, m - 1, d - n);
  return localDateString(when);
}

/**
 * @param {{ api: typeof import('./api.js'), root: HTMLElement, openFreePlay: () => void }} deps
 */
export function createGallery({ api, root, openFreePlay }) {
  /** Bumped whenever the view changes, so late responses for an old view get ignored. */
  let viewToken = 0;
  let observer = null;
  let me = null;
  const liked = new Set();
  /** postId -> functions that repaint its like buttons */
  const likeButtons = new Map();
  const likeTimers = new Map();
  const knownCounts = new Map();
  let showBlobs = readSetting('galleryBlobs', true) !== false;
  root.classList.toggle('blobs-off', !showBlobs);

  /** A button that shows or hides the blobs on every card. CSS does the work, so nothing reloads. */
  function blobToggle() {
    const button = el('button', {
      type: 'button',
      class: 'chip blob-toggle',
      onclick: () => {
        showBlobs = !showBlobs;
        writeSetting('galleryBlobs', showBlobs);
        root.classList.toggle('blobs-off', !showBlobs);
        paint();
      },
    });
    const paint = () => {
      button.replaceChildren(icon(showBlobs ? 'eye' : 'eye-off'), showBlobs ? 'Blobs on' : 'Blobs off');
      button.setAttribute('aria-pressed', String(showBlobs));
    };
    paint();
    return button;
  }

  function offlineState(retry) {
    return el(
      'div',
      { class: 'empty' },
      el('h2', {}, 'The gallery is offline'),
      el('p', {}, "We can't reach the gallery right now. Drawing and saving to Mine still work fine."),
      el(
        'div',
        { class: 'row' },
        api.isConfigured ? el('button', { type: 'button', class: 'button', onclick: retry }, 'Try again') : null,
        el('a', { class: 'button primary', href: '#/draw' }, 'Go draw'),
      ),
    );
  }

  const skeletons = (n = 6) => Array.from({ length: n }, () => el('div', { class: 'skeleton', 'aria-hidden': 'true' }));

  function paintLike(id) {
    for (const paint of likeButtons.get(id) ?? []) paint();
  }

  /**
   * Optimistic like: the heart changes right away, the request waits out a short debounce,
   * and a failure puts things back. Rapid tapping only sends the final state.
   */
  function toggleLike(post) {
    const was = liked.has(post.id);
    const now = !was;
    if (now) liked.add(post.id);
    else liked.delete(post.id);
    knownCounts.set(post.id, Math.max(0, (knownCounts.get(post.id) ?? 0) + (now ? 1 : -1)));
    paintLike(post.id);

    let entry = likeTimers.get(post.id);
    if (!entry) {
      entry = { confirmed: was, timer: null };
      likeTimers.set(post.id, entry);
    }
    clearTimeout(entry.timer);
    entry.timer = setTimeout(async () => {
      likeTimers.delete(post.id);
      const target = liked.has(post.id);
      if (target === entry.confirmed) return;
      try {
        await api.setLike(post.id, target);
        me = me ?? (await api.currentUserId());
      } catch {
        if (entry.confirmed) liked.add(post.id);
        else liked.delete(post.id);
        knownCounts.set(post.id, Math.max(0, (knownCounts.get(post.id) ?? 0) + (entry.confirmed ? 1 : -1)));
        paintLike(post.id);
        toast("Couldn't save that like. Try again in a moment.");
      }
    }, LIKE_DEBOUNCE_MS);
  }

  function likeButton(post) {
    const label = el('span', {});
    const iconHost = el('span', {});
    const own = me !== null && post.user_id === me;
    const button = el('button', {
      type: 'button',
      class: 'like',
      disabled: own,
      title: own ? "You can't like your own post" : null,
      onclick: (e) => {
        e.preventDefault();
        toggleLike(post);
      },
    }, iconHost, label);
    if (!knownCounts.has(post.id)) knownCounts.set(post.id, post.like_count);
    const paint = () => {
      const isLiked = liked.has(post.id);
      const count = knownCounts.get(post.id) ?? 0;
      iconHost.replaceChildren(icon(isLiked ? 'heart-filled' : 'heart'));
      label.textContent = String(count);
      button.setAttribute('aria-pressed', String(isLiked));
      button.setAttribute('aria-label', `${isLiked ? 'Unlike' : 'Like'}. ${count} ${count === 1 ? 'like' : 'likes'}.`);
    };
    if (!likeButtons.has(post.id)) likeButtons.set(post.id, []);
    likeButtons.get(post.id).push(paint);
    paint();
    return button;
  }

  async function copyPostLink(post) {
    const url = `${window.location.origin}${window.location.pathname}#/post/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied.');
    } catch {
      toast(url);
    }
  }

  async function reportFlow(post) {
    let reason = '';
    const ok = await openDialog((close) => [
      el('h2', {}, 'Report this post?'),
      el('p', {}, 'Three reports hide a post until it has been reviewed.'),
      el(
        'label',
        { class: 'field' },
        "What's wrong? (optional)",
        el('input', {
          type: 'text',
          maxLength: 200,
          oninput: (e) => { reason = e.target.value; },
        }),
      ),
      el('p', { class: 'notice' }, el('a', { href: '#/rules', onclick: () => close(false) }, 'Read the community rules')),
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'button', onclick: () => close(false) }, 'Cancel'),
        el('button', { type: 'button', class: 'button danger', onclick: () => close(true) }, 'Report'),
      ),
    ], { label: 'Report this post' });
    if (!ok) return;
    try {
      await api.reportPost(post.id, reason.trim());
      toast('Thanks. Your report was sent.');
    } catch {
      toast("Couldn't send that report. Try again in a moment.");
    }
  }

  async function deleteFlow(post) {
    const ok = await confirmDialog({
      title: 'Delete your post?',
      body: 'It leaves the gallery along with its likes. Your copy in Mine stays.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePost(post);
      toast('Post deleted.');
      const home = post.daily_date ? '#/today' : '#/unlimiteds';
      if (window.location.hash !== home) window.location.hash = home;
      else if (post.daily_date) showToday();
      else showUnlimiteds();
    } catch {
      toast("Couldn't delete that post. Try again in a moment.");
    }
  }

  function moreMenu(post) {
    return el('button', {
      type: 'button',
      class: 'icon-button',
      'aria-label': 'More options',
      onclick: () => openDialog((close) => {
        const choice = (label, action) => el('button', {
          type: 'button',
          class: 'choice',
          onclick: () => {
            close();
            action();
          },
        }, el('strong', {}, label));
        const own = me !== null && post.user_id === me;
        return [
          el('h2', {}, `By ${nameOf(post)}`),
          el(
            'div',
            { class: 'choices' },
            choice('Copy link', () => copyPostLink(post)),
            own ? choice('Delete my post', () => deleteFlow(post)) : choice('Report', () => reportFlow(post)),
          ),
          el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Close')),
        ];
      }, { label: 'Post options' }),
    }, icon('more'));
  }

  function postPair(post, { large = false } = {}) {
    const art = el('img', {
      src: api.imageUrl(large ? post.image_path : post.thumb_path),
      alt: `Artwork by ${nameOf(post)}`,
      loading: large ? 'eager' : 'lazy',
      width: large ? IMAGE_SIZE : THUMB_SIZE,
      height: large ? IMAGE_SIZE : THUMB_SIZE,
    });
    const path = postPath(post);
    // The art is transparent, so the right cell can stack it over the blob. The blob toggle
    // hides the left cell and the blob under the art, leaving just the drawing.
    return el(
      'div',
      { class: large ? 'pair pair-large' : 'pair' },
      el('div', { class: 'pair-cell pair-cell-blob' }, blobSvg(path, post.transform, post.blob_style)),
      el('div', { class: 'pair-cell pair-cell-art' }, blobSvg(path, post.transform, post.blob_style), art),
    );
  }

  function card(post, { showDate }) {
    let when;
    if (!post.daily_date) when = postedOn(post);
    else if (showDate) when = `Splotch #${challengeNumber(post.daily_date)}, ${formatDate(post.daily_date)}`;
    else when = new Date(post.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return el(
      'article',
      { class: 'card', 'data-post': post.id },
      post.hidden ? el('span', { class: 'badge' }, 'Hidden pending review') : null,
      el('a', { class: 'card-link', href: `#/post/${post.id}`, 'aria-label': `Open the post by ${nameOf(post)}` }, postPair(post)),
      el(
        'div',
        { class: 'card-foot' },
        el(
          'div',
          { class: 'card-meta' },
          el('div', { class: 'card-name' }, nameOf(post)),
          el('div', { class: 'card-sub' }, when),
        ),
        likeButton(post),
        moreMenu(post),
      ),
    );
  }

  /**
   * Runs an infinitely scrolling grid in a container.
   * @param {HTMLElement} host
   * @param {{ query: object, showDate: boolean, emptyState: () => Node }} options
   */
  function runGrid(host, { query, showDate, emptyState }) {
    const token = ++viewToken;
    observer?.disconnect();
    likeButtons.clear();
    const grid = el('div', { class: 'card-grid' }, ...skeletons());
    const sentinel = el('div', { class: 'sentinel', 'aria-hidden': 'true' });
    const status = el('div', { class: 'load-state' });
    host.replaceChildren(grid, status, sentinel);

    let cursor = null;
    let loading = false;
    let started = false;

    const loadMore = async () => {
      if (loading) return;
      loading = true;
      try {
        const { posts, hasMore } = await api.listPosts({ ...query, cursor });
        if (token !== viewToken) return;
        me = await api.currentUserId();
        const mine = await api.getMyLikes(posts.map((p) => p.id));
        if (token !== viewToken) return;
        for (const id of mine) liked.add(id);
        for (const post of posts) knownCounts.set(post.id, post.like_count);
        if (!started) {
          grid.replaceChildren();
          started = true;
        }
        grid.append(...posts.map((post) => card(post, { showDate })));
        if (posts.length > 0) cursor = posts[posts.length - 1];
        if (!hasMore) {
          observer?.disconnect();
          if (grid.children.length === 0) host.replaceChildren(emptyState());
        } else {
          // An observer only fires on changes. On a tall screen the sentinel can still be in
          // range after a page loads, so re-observing makes it check again.
          observer?.unobserve(sentinel);
          observer?.observe(sentinel);
        }
      } catch (err) {
        if (token !== viewToken) return;
        console.warn('Splotchle gallery:', err);
        observer?.disconnect();
        if (!started) {
          host.replaceChildren(offlineState(() => runGrid(host, { query, showDate, emptyState })));
        } else {
          status.replaceChildren(el('button', {
            type: 'button',
            class: 'button',
            onclick: () => {
              status.replaceChildren();
              observer?.observe(sentinel);
              loadMore();
            },
          }, "Couldn't load more. Try again"));
        }
      } finally {
        loading = false;
      }
    };

    if (!api.isConfigured) {
      host.replaceChildren(offlineState());
      return;
    }
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '600px' });
    observer.observe(sentinel);
  }

  function chips(options, current, onPick) {
    const host = el('div', { class: 'chips', role: 'group' });
    for (const [value, label] of options) {
      host.append(el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(value === current),
        onclick: () => onPick(value),
      }, label));
    }
    return host;
  }

  let todaySort = 'new';
  function showToday() {
    const today = localDateString();
    const grid = el('div', {});
    const color = colorForSeed(dailySeed(today));
    root.replaceChildren(
      el(
        'div',
        { class: 'hero' },
        el('div', { class: 'hero-blob' }, blobSvg(dailyPath(today, GEN_VERSION), null, { color, mode: 'fill' })),
        el(
          'div',
          { class: 'hero-text' },
          el('h1', {}, `Splotch #${challengeNumber(today)}`),
          el('p', { class: 'muted' }, `${formatDate(today)}. Everyone got this blob today. What did they see in it?`),
          el('a', { class: 'button primary', href: '#/draw' }, 'Draw yours'),
        ),
      ),
      el(
        'div',
        { class: 'gallery-controls' },
        el('h2', {}, "Today's gallery"),
        el('div', { class: 'row' }, blobToggle(), chips([['new', 'New'], ['top', 'Top']], todaySort, (sort) => {
          todaySort = sort;
          showToday();
        })),
      ),
      grid,
    );
    runGrid(grid, {
      query: { sort: todaySort, date: today },
      showDate: false,
      emptyState: () => el(
        'div',
        { class: 'empty' },
        el('h2', {}, 'Nobody has posted yet'),
        el('p', {}, 'You could be the first one in today.'),
        el('a', { class: 'button primary', href: '#/draw' }, 'Draw yours'),
      ),
    });
  }

  let allTimeRange = 'all';
  function showAllTime() {
    const today = localDateString();
    const since = { week: daysBefore(today, 6), month: daysBefore(today, 29), all: undefined }[allTimeRange];
    const grid = el('div', {});
    root.replaceChildren(
      el(
        'div',
        { class: 'view-head' },
        el('div', {}, el('h1', {}, 'All-Time Gallery'), el('p', { class: 'muted' }, 'The most-liked characters from every day so far.')),
        el('div', { class: 'row' }, blobToggle(), chips([['week', 'This week'], ['month', 'This month'], ['all', 'All time']], allTimeRange, (range) => {
          allTimeRange = range;
          showAllTime();
        })),
      ),
      grid,
    );
    runGrid(grid, {
      query: { sort: 'top', since },
      showDate: true,
      emptyState: () => el('div', { class: 'empty' }, el('h2', {}, 'No posts here yet'), el('p', {}, 'Try a longer time range.')),
    });
  }

  let unlimitedSort = 'new';
  function showUnlimiteds() {
    const grid = el('div', {});
    const drawButton = () => el('button', { type: 'button', class: 'button primary', onclick: openFreePlay }, 'Draw in free play');
    root.replaceChildren(
      el(
        'div',
        { class: 'view-head' },
        el(
          'div',
          {},
          el('h1', {}, 'Unlimiteds'),
          el('p', { class: 'muted' }, "Free play drawings, each on its own blob. They stay separate from Today and All-Time."),
        ),
        el('div', { class: 'row' }, drawButton(), blobToggle(), chips([['new', 'New'], ['top', 'Top']], unlimitedSort, (sort) => {
          unlimitedSort = sort;
          showUnlimiteds();
        })),
      ),
      grid,
    );
    runGrid(grid, {
      query: { sort: unlimitedSort, unlimited: true },
      showDate: true,
      emptyState: () => el(
        'div',
        { class: 'empty' },
        el('h2', {}, 'Nobody has posted yet'),
        el('p', {}, 'Draw on any free play blob and post it here.'),
        drawButton(),
      ),
    });
  }

  async function showPost(id) {
    const token = ++viewToken;
    observer?.disconnect();
    likeButtons.clear();
    root.replaceChildren(el('div', { class: 'post-detail' }, ...skeletons(1)));
    if (!api.isConfigured) {
      root.replaceChildren(offlineState());
      return;
    }
    try {
      const post = await api.getPost(id);
      if (token !== viewToken) return;
      if (!post) {
        root.replaceChildren(el(
          'div',
          { class: 'empty' },
          el('h2', {}, "That post isn't here"),
          el('p', {}, 'It may have been deleted or hidden.'),
          el('a', { class: 'button primary', href: '#/today' }, "Today's gallery"),
        ));
        return;
      }
      me = await api.currentUserId();
      for (const likedId of await api.getMyLikes([post.id])) liked.add(likedId);
      knownCounts.set(post.id, post.like_count);
      if (token !== viewToken) return;
      root.replaceChildren(el(
        'div',
        { class: 'post-detail' },
        el(
          'div',
          { class: 'view-head' },
          el(
            'div',
            {},
            el('h1', {}, nameOf(post)),
            el('p', { class: 'muted' }, post.daily_date
              ? `Splotch #${challengeNumber(post.daily_date)}, ${formatDate(post.daily_date)}`
              : `Unlimited, ${postedOn(post)}`),
          ),
          el('div', { class: 'row' }, blobToggle(), likeButton(post), moreMenu(post)),
        ),
        post.hidden ? el('span', { class: 'badge' }, 'Hidden pending review') : null,
        postPair(post, { large: true }),
      ));
    } catch (err) {
      if (token !== viewToken) return;
      console.warn('Splotchle gallery:', err);
      root.replaceChildren(offlineState(() => showPost(id)));
    }
  }

  /** Posting flow: a confirmation step with the preview, the name and the rules, then upload. */
  async function openPostDialog(payload) {
    if (!api.isConfigured) {
      toast('The gallery is offline right now. You can still save your art to Mine.');
      return;
    }
    const unlimited = payload.dailyDate === null;
    if (!unlimited && daysBetween(payload.dailyDate, localDateString()) !== 0) {
      toast('That blob has expired. Only today\'s blob can be posted.');
      return;
    }
    const galleryName = unlimited ? 'Unlimiteds' : "today's gallery";
    // What's uploaded is the drawing alone, on transparent. This preview shows it as viewers
    // will first see it: on top of the blob.
    const preview = renderPanel(payload, THUMB_SIZE, { blob: true });
    preview.className = 'post-preview';
    let existingName = null;
    try {
      existingName = await api.getMyName();
    } catch {
      // Treat it as no name yet. Real connection problems surface when posting.
    }
    await openDialog((close) => {
      const error = el('p', { class: 'field-error', role: 'alert' });
      const nameInput = el('input', { type: 'text', value: existingName ?? api.randomDisplayName(), maxLength: 24, autocomplete: 'off' });
      const submit = el('button', {
        type: 'button',
        class: 'button accent',
        onclick: async () => {
          const name = nameInput.value.trim();
          const nameProblem = api.displayNameError(name);
          if (nameProblem) {
            error.textContent = nameProblem;
            return;
          }
          error.textContent = '';
          submit.disabled = true;
          submit.textContent = 'Posting…';
          try {
            const image = await encodeUnderLimit(renderDrawing(payload.drawing, IMAGE_SIZE), MAX_IMAGE_BYTES);
            const thumb = await encodeUnderLimit(renderDrawing(payload.drawing, THUMB_SIZE), MAX_THUMB_BYTES);
            if (name !== existingName) await api.saveMyName(name);
            existingName = name;
            await api.createPost({
              dailyDate: payload.dailyDate,
              ...(unlimited ? { seed: payload.seed, params: payload.params } : {}),
              genVersion: payload.genVersion,
              transform: payload.transform,
              blobStyle: payload.blobStyle,
              image,
              thumb,
            });
            close();
            toast(`You're in ${galleryName}!`);
            window.location.hash = unlimited ? '#/unlimiteds' : '#/today';
          } catch (err) {
            console.warn('Splotchle post:', err);
            submit.disabled = false;
            submit.textContent = 'Post it';
            if (err.code === '23505') {
              error.textContent = "You've already posted today. To post again, delete your old post from the gallery first.";
            } else if (err.code === '23514') {
              error.textContent = "That name isn't allowed. Try a different one.";
            } else if (err.code === 'P0429') {
              error.textContent = "You've posted a lot to Unlimiteds lately. Try again later, or delete an older post to make room.";
            } else if (err.code === 'anonymous_provider_disabled') {
              // See step 2 of supabase/README.md: "Allow anonymous sign-ins" in the dashboard.
              error.textContent = 'Gallery sign-in is switched off right now, so nothing can be posted. Your drawing is still safe here.';
            } else {
              error.textContent = err.message?.includes('too detailed')
                ? err.message
                : "Couldn't post that right now. Your drawing is still safe here.";
            }
          }
        },
      }, 'Post it');
      return [
        el('h2', {}, `Post to ${galleryName}?`),
        preview,
        el('p', { class: 'notice' }, 'In the gallery, your art appears next to the blob, and viewers can switch blobs off to see just your drawing.'),
        el('label', { class: 'field' }, 'Posting as', nameInput),
        el(
          'p',
          { class: 'notice' },
          'Be kind. No NSFW, nothing hateful, no personal info. ',
          el('a', { href: '#/rules', onclick: () => close() }, 'Community rules'),
          unlimited
            ? '. Post as many as you like, up to 20 a day, and anyone can see them.'
            : '. You get one post per day, and anyone can see it.',
        ),
        error,
        el(
          'div',
          { class: 'dialog-actions' },
          el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Cancel'),
          submit,
        ),
      ];
    }, { label: `Post to ${galleryName}` });
  }

  // Refresh visible like counts when the tab regains focus. Live updates aren't needed.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || root.hidden || !api.isConfigured) return;
    const ids = [...likeButtons.keys()];
    if (ids.length === 0) return;
    try {
      const counts = await api.getLikeCounts(ids);
      for (const [id, count] of counts) {
        if (!likeTimers.has(id)) {
          knownCounts.set(id, count);
          paintLike(id);
        }
      }
    } catch {
      // The old counts are fine until next time.
    }
  });

  return {
    showToday,
    showAllTime,
    showUnlimiteds,
    showPost,
    openPostDialog,
  };
}
