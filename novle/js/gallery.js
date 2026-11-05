// The public gallery views: Today, All-Time and single stories, plus the posting flow.
// The api module is passed in, which lets tests/gallery-preview.html run on fake data.

import {
  challengeNumber, daysBefore, daysBetween, localDateString,
} from './daily.js';
import { GENRES, dailyChallenge, fullPrompt } from './prompts.js';
import { countWords, readingTime } from './words.js';
import {
  confirmDialog, el, formatDate, icon, openDialog, toast,
} from './ui.js';

const LIKE_DEBOUNCE_MS = 300;

const nameOf = (post) => post.profiles?.display_name ?? 'Anonymous';

/**
 * @param {{ api: typeof import('./api.js'), root: HTMLElement }} deps
 */
export function createGallery({ api, root }) {
  /** Bumped whenever the view changes, so late responses for an old view get ignored. */
  let viewToken = 0;
  let observer = null;
  let me = null;
  const liked = new Set();
  /** postId -> functions that repaint its like buttons */
  const likeButtons = new Map();
  const likeTimers = new Map();
  const knownCounts = new Map();

  function offlineState(retry) {
    return el(
      'div',
      { class: 'empty' },
      el('h2', {}, 'The gallery is offline'),
      el('p', {}, "We can't reach the gallery right now. Writing and saving to Mine still work fine."),
      el(
        'div',
        { class: 'row' },
        api.isConfigured ? el('button', { type: 'button', class: 'button', onclick: retry }, 'Try again') : null,
        el('a', { class: 'button primary', href: '#/write' }, 'Go write'),
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
      title: own ? "You can't like your own story" : null,
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
      el('h2', {}, 'Report this story?'),
      el('p', {}, 'Three reports hide a story until it has been reviewed.'),
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
    ], { label: 'Report this story' });
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
      if (window.location.hash === '#/today') showToday();
      else window.location.hash = '#/today';
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
      }, { label: 'Story options' }),
    }, icon('more'));
  }

  const wordsLine = (post) => `${post.word_count.toLocaleString()} words, ${readingTime(post.word_count)}`;

  function card(post, { showDate }) {
    const sub = showDate
      ? `${post.genre}, Novle #${challengeNumber(post.daily_date)}. ${wordsLine(post)}.`
      : `${wordsLine(post)}.`;
    return el(
      'article',
      { class: 'card', 'data-post': post.id },
      post.hidden ? el('span', { class: 'badge' }, 'Hidden pending review') : null,
      el(
        'a',
        { class: 'card-link', href: `#/post/${post.id}` },
        el('span', { class: 'card-title' }, post.title),
        el('span', { class: 'card-excerpt' }, post.excerpt.replace(/\s+/g, ' ')),
      ),
      el(
        'div',
        { class: 'card-foot' },
        el(
          'div',
          { class: 'card-meta' },
          el('div', { class: 'card-name' }, nameOf(post)),
          el('div', { class: 'card-sub' }, sub),
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
        console.warn('Novle gallery:', err);
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
    // On a phone the skeletons can push the sentinel out of range, so never wait on it for page one.
    loadMore();
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
    const challenge = dailyChallenge(today);
    const grid = el('div', {});
    root.replaceChildren(
      el(
        'div',
        { class: 'hero' },
        el(
          'div',
          { class: 'hero-text' },
          el('h1', {}, `Novle #${challengeNumber(today)}`),
          el('p', { class: 'muted' }, `${formatDate(today)}. Everyone got this prompt today. Where did they take it?`),
          el(
            'div',
            { class: 'row' },
            el('span', { class: 'tag' }, challenge.genre),
            el('span', { class: 'tag' }, `${challenge.wordLimit.toLocaleString()} words`),
          ),
          el('p', { class: 'prompt-text' }, fullPrompt(challenge)),
          el('a', { class: 'button primary', href: '#/write' }, 'Write yours'),
        ),
      ),
      el(
        'div',
        { class: 'gallery-controls' },
        el('h2', {}, "Today's stories"),
        chips([['new', 'New'], ['top', 'Top']], todaySort, (sort) => {
          todaySort = sort;
          showToday();
        }),
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
        el('a', { class: 'button primary', href: '#/write' }, 'Write yours'),
      ),
    });
  }

  let allTimeRange = 'all';
  let allTimeGenre = '';
  function showAllTime() {
    const today = localDateString();
    const since = { week: daysBefore(today, 6), month: daysBefore(today, 29), all: undefined }[allTimeRange];
    const grid = el('div', {});
    const genreSelect = el(
      'select',
      {
        'aria-label': 'Filter by genre',
        onchange: (e) => {
          allTimeGenre = e.target.value;
          showAllTime();
        },
      },
      el('option', { value: '' }, 'All genres'),
      ...GENRES.map((genre) => el('option', { value: genre }, genre)),
    );
    genreSelect.value = allTimeGenre;
    root.replaceChildren(
      el(
        'div',
        { class: 'view-head' },
        el('div', {}, el('h1', {}, 'All-Time Stories'), el('p', { class: 'muted' }, 'The most-liked stories from every day so far.')),
        el('div', { class: 'row' }, genreSelect, chips([['week', 'This week'], ['month', 'This month'], ['all', 'All time']], allTimeRange, (range) => {
          allTimeRange = range;
          showAllTime();
        })),
      ),
      grid,
    );
    runGrid(grid, {
      query: { sort: 'top', since, genre: allTimeGenre || undefined },
      showDate: true,
      emptyState: () => el('div', { class: 'empty' }, el('h2', {}, 'No stories here yet'), el('p', {}, 'Try a longer time range or another genre.')),
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
          el('h2', {}, "That story isn't here"),
          el('p', {}, 'It may have been deleted or hidden.'),
          el('a', { class: 'button primary', href: '#/today' }, "Today's stories"),
        ));
        return;
      }
      me = await api.currentUserId();
      for (const likedId of await api.getMyLikes([post.id])) liked.add(likedId);
      knownCounts.set(post.id, post.like_count);
      if (token !== viewToken) return;
      root.replaceChildren(el(
        'article',
        { class: 'post-detail' },
        post.hidden ? el('span', { class: 'badge' }, 'Hidden pending review') : null,
        el('h1', { class: 'reader-title' }, post.title),
        el('p', { class: 'muted' }, `By ${nameOf(post)}. Novle #${challengeNumber(post.daily_date)}, ${formatDate(post.daily_date)}. ${wordsLine(post)}.`),
        el(
          'div',
          { class: 'prompt-quote' },
          el('strong', {}, `${post.genre}, ${post.word_limit.toLocaleString()} words. `),
          post.prompt,
        ),
        el('div', { class: 'story-text' }, post.body),
        el('div', { class: 'row post-actions' }, likeButton(post), moreMenu(post)),
      ));
    } catch (err) {
      if (token !== viewToken) return;
      console.warn('Novle gallery:', err);
      root.replaceChildren(offlineState(() => showPost(id)));
    }
  }

  /** Posting flow: a confirmation step with a preview, the name and the rules. */
  async function openPostDialog(payload) {
    if (!api.isConfigured) {
      toast('The gallery is offline right now. Your story is saved in Mine.');
      return;
    }
    if (daysBetween(payload.dailyDate, localDateString()) !== 0) {
      toast("That prompt has closed. Only today's prompt can be posted.");
      return;
    }
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
          let savingName = false;
          try {
            if (name !== existingName) {
              savingName = true;
              await api.saveMyName(name);
              savingName = false;
              existingName = name;
            }
            await api.createPost({
              dailyDate: payload.dailyDate,
              genre: payload.challenge.genre,
              wordLimit: payload.challenge.wordLimit,
              prompt: fullPrompt(payload.challenge),
              title: payload.title,
              body: payload.body,
            });
            close();
            toast("You're in today's gallery!");
            window.location.hash = '#/today';
          } catch (err) {
            console.warn('Novle post:', err);
            submit.disabled = false;
            submit.textContent = 'Post it';
            if (err.code === '23505') {
              error.textContent = "You've already posted today. To post again, delete your old post from the gallery first.";
            } else if (err.code === '23514') {
              error.textContent = savingName
                ? "That name isn't allowed. Try a different one."
                : "The gallery wouldn't accept this story. Check the word limit and the title.";
            } else {
              error.textContent = "Couldn't post that right now. Your story is still safe here.";
            }
          }
        },
      }, 'Post it');
      return [
        el('h2', {}, "Post to today's gallery?"),
        el(
          'div',
          { class: 'post-preview' },
          el('strong', {}, payload.title),
          el('span', { class: 'card-excerpt' }, payload.body.slice(0, 240).replace(/\s+/g, ' ')),
          el('span', { class: 'card-sub' }, `${countWords(payload.body).toLocaleString()} words`),
        ),
        el('label', { class: 'field' }, 'Posting as', nameInput),
        el(
          'p',
          { class: 'notice' },
          'Be kind, and post your own writing. ',
          el('a', { href: '#/rules', onclick: () => close() }, 'Community rules'),
          '. You get one post per day, posts can\'t be edited, and anyone can read them.',
        ),
        error,
        el(
          'div',
          { class: 'dialog-actions' },
          el('button', { type: 'button', class: 'button', onclick: () => close() }, 'Cancel'),
          submit,
        ),
      ];
    }, { label: "Post to today's gallery" });
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
    showPost,
    openPostDialog,
  };
}
