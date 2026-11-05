// The Write view: the editor, autosave, today's prompt, practice and past prompts, saving.

import {
  LAUNCH_DATE, challengeNumber, currentStreak, daysBefore, emptyStreak, localDateString, recordDaily,
} from './daily.js';
import { dailyChallenge, practiceChallenge } from './prompts.js';
import { countWords, postProblem } from './words.js';
import {
  getDraft, putDraft, putStory, readSetting, writeSetting,
} from './storage.js';
import {
  confirmDialog, formatDate, newId, toast,
} from './ui.js';

const AUTOSAVE_MS = 1000;
const ROLLOVER_CHECK_MS = 60000;

const $ = (id) => document.getElementById(id);

const randomSeed = () => Math.random().toString(36).slice(2, 10);

/** Turns a title into a safe file name. */
const fileName = (title) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story'}.txt`;

/**
 * Saves text as a download.
 * @param {string} title
 * @param {string} body
 */
export function downloadStory(title, body) {
  const url = URL.createObjectURL(new Blob([`${title}\n\n${body}\n`], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName(title) });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {{ onPost: (payload: object) => void }} deps
 */
export function createWriter({ onPost }) {
  let active = true;
  let streak = readSetting('streak', emptyStreak());
  let announcedDate = null;

  /** The story being worked on. */
  const state = {
    mode: 'daily', // which draft slot this is: 'daily' or 'free'
    dailyDate: null, // set for today's challenge only, not for practice or past days
    label: '', // the heading for practice and past prompts
    challenge: null,
    title: '',
    body: '',
    storyId: null,
    createdAt: null,
    dirty: false,
  };

  const hasText = () => state.body.trim().length > 0;
  const isExpired = () => state.mode === 'daily' && state.dailyDate !== localDateString();

  // --- Showing the current state ---

  function paintWordCount() {
    const words = countWords(state.body);
    const limit = state.challenge.wordLimit;
    const over = words > limit;
    $('word-count').textContent = `${words.toLocaleString()} / ${limit.toLocaleString()} words`;
    $('word-count').classList.toggle('over', over);
    $('word-meter-fill').style.width = `${Math.min(100, (words / limit) * 100)}%`;
    $('word-meter').classList.toggle('over', over);

    let note = '';
    let canPost = false;
    if (state.mode === 'free') {
      note = over ? `${(words - limit).toLocaleString()} over this prompt's limit.` : '';
    } else if (isExpired()) {
      note = 'This prompt closed at midnight. Your story is safe, but only today\'s prompt can be posted.';
    } else {
      const problem = postProblem(state.body, limit);
      canPost = !problem;
      // No need to nag about the minimum before anyone has typed.
      note = hasText() ? problem ?? '' : '';
    }
    $('word-note').textContent = note;
    $('post').disabled = !canPost;
  }

  function paintStreak() {
    const days = currentStreak(streak, localDateString());
    $('streak').hidden = days === 0;
    $('streak').textContent = `${days} day streak`;
  }

  function show() {
    const { challenge, mode } = state;
    const daily = mode === 'daily';
    $('challenge-title').textContent = daily ? `Novle #${challengeNumber(state.dailyDate)}` : state.label || 'Practice';
    $('challenge-sub').textContent = daily
      ? `${formatDate(state.dailyDate)}. A new prompt arrives at midnight, your time.`
      : "Practice stories stay in Mine, and don't count toward your streak.";
    $('prompt-genre').textContent = challenge.genre;
    $('prompt-limit').textContent = `${challenge.wordLimit.toLocaleString()} words`;
    $('prompt-text').textContent = challenge.prompt;
    $('prompt-wrinkle').hidden = !challenge.wrinkle;
    $('prompt-wrinkle-text').textContent = challenge.wrinkle ?? '';
    $('story-title').value = state.title;
    $('story-body').value = state.body;
    $('post').hidden = !daily;
    $('daily-section').hidden = !daily;
    $('free-section').hidden = daily;
    paintWordCount();
    paintStreak();
    const today = localDateString();
    $('past-date').min = LAUNCH_DATE;
    $('past-date').max = daysBefore(today, 1);
    $('past-section').hidden = today <= LAUNCH_DATE;
  }

  function setSaveState(text) {
    $('save-state').textContent = text;
  }

  // --- Autosave ---

  let autosaveTimer = null;

  async function writeDraft() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    const ok = await putDraft(state.mode, {
      dailyDate: state.dailyDate,
      label: state.label,
      challenge: state.challenge,
      title: state.title,
      body: state.body,
      storyId: state.storyId,
      createdAt: state.createdAt,
      dirty: state.dirty,
      updatedAt: Date.now(),
    });
    if (ok && state.dirty) setSaveState('Draft kept on this device');
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(writeDraft, AUTOSAVE_MS);
  }

  /** Writes now, but only if a change is waiting, so a switch can't lose the last second of work. */
  async function flushAutosave() {
    if (autosaveTimer !== null) await writeDraft();
  }

  // --- Loading stories ---

  function load(mode, fields) {
    state.mode = mode;
    writeSetting('lastMode', mode);
    Object.assign(state, {
      dailyDate: null,
      label: '',
      title: '',
      body: '',
      storyId: null,
      createdAt: null,
      dirty: false,
    }, fields);
    setSaveState('');
  }

  const freshDaily = (today) => load('daily', { dailyDate: today, challenge: dailyChallenge(today) });
  const freshPractice = () => load('free', { challenge: practiceChallenge(randomSeed()) });

  const restoreDraft = (draft) => load(draft.slot, {
    dailyDate: draft.dailyDate,
    label: draft.label,
    challenge: draft.challenge,
    title: draft.title,
    body: draft.body,
    storyId: draft.storyId,
    createdAt: draft.createdAt,
    dirty: draft.dirty,
  });

  /** Opens today's challenge, filing away unsaved work left over from an earlier day. */
  async function openDaily() {
    const today = localDateString();
    const draft = await getDraft('daily');
    if (draft && draft.dailyDate === today) {
      restoreDraft(draft);
    } else {
      if (draft && draft.dirty && draft.body.trim()) {
        restoreDraft(draft);
        if (await saveStory({ quiet: true, countStreak: false })) {
          toast('Your unsaved story from an earlier day was saved to Mine.');
        }
      }
      freshDaily(today);
      await writeDraft();
    }
    show();
  }

  async function openFree() {
    const draft = await getDraft('free');
    if (draft) {
      restoreDraft(draft);
    } else {
      freshPractice();
      await writeDraft();
    }
    show();
  }

  async function switchMode(mode) {
    await flushAutosave();
    if (mode === 'daily') await openDaily();
    else await openFree();
  }

  /** Asks before something would replace work that isn't saved. */
  async function okToReplaceSlot(slot, message) {
    const draft = slot === state.mode ? state : await getDraft(slot);
    if (!draft || !draft.dirty || !draft.body.trim()) return true;
    return confirmDialog({
      title: 'Replace your unsaved story?',
      body: `${message} You have an unsaved story in ${slot === 'free' ? 'practice' : "today's prompt"} that would be lost.`,
      confirm: 'Replace it',
      danger: true,
    });
  }

  async function newPracticePrompt() {
    if (!(await okToReplaceSlot('free', 'This starts a new practice prompt.'))) return;
    await flushAutosave();
    freshPractice();
    show();
    await writeDraft();
    $('story-body').focus();
  }

  async function openPastDate(date) {
    if (!(await okToReplaceSlot('free', `This opens the prompt from ${formatDate(date)}.`))) return;
    await flushAutosave();
    load('free', {
      challenge: dailyChallenge(date),
      label: `Novle #${challengeNumber(date)}, ${formatDate(date)}`,
    });
    show();
    await writeDraft();
  }

  /**
   * Reopens a saved story for more writing.
   * @param {object} record a story from storage
   * @returns {Promise<boolean>} whether it opened
   */
  async function openStory(record) {
    const today = localDateString();
    const slot = record.dailyDate === today ? 'daily' : 'free';
    if (!(await okToReplaceSlot(slot, `This opens "${record.title}".`))) return false;
    await flushAutosave();
    load(slot, {
      dailyDate: slot === 'daily' ? today : null,
      label: slot === 'daily' ? '' : record.label,
      challenge: record.challenge,
      title: record.title,
      body: record.body,
      storyId: record.id,
      createdAt: record.createdAt,
    });
    show();
    await writeDraft();
    return true;
  }

  // --- Saving ---

  /** A name for a story nobody titled. */
  function defaultTitle() {
    if (state.dailyDate) return `Novle #${challengeNumber(state.dailyDate)}`;
    return state.label || 'Practice story';
  }

  async function saveStory({ quiet = false, countStreak = true } = {}) {
    if (!hasText()) {
      toast('Write something first!');
      return false;
    }
    const today = localDateString();
    const now = Date.now();
    const isTodays = state.dailyDate === today;
    const id = state.storyId ?? newId();
    const createdAt = state.createdAt ?? now;
    const saved = await putStory({
      id,
      createdAt,
      updatedAt: now,
      isDaily: state.dailyDate !== null,
      dailyDate: state.dailyDate,
      label: state.label,
      challenge: state.challenge,
      title: state.title.trim() || defaultTitle(),
      body: state.body,
      wordCount: countWords(state.body),
    });
    if (!saved) return false;
    state.storyId = id;
    state.createdAt = createdAt;
    state.dirty = false;
    if (isTodays && countStreak) {
      streak = recordDaily(streak, today);
      writeSetting('streak', streak);
    }
    paintStreak();
    await writeDraft();
    setSaveState('Saved to Mine');
    if (!quiet) {
      const days = currentStreak(streak, today);
      toast(isTodays && days > 0 ? `Saved to Mine. ${days} day streak!` : 'Saved to Mine.', {
        action: 'View',
        onAction: () => { window.location.hash = '#/mine'; },
      });
    }
    return true;
  }

  /** Spots midnight passing while the page is open. The story stays put until they choose. */
  function checkRollover() {
    if (!isExpired()) return;
    paintWordCount();
    const today = localDateString();
    if (announcedDate === today) return;
    announcedDate = today;
    toast("It's a new day, and there's a new prompt.", {
      action: 'Open it',
      onAction: () => switchMode('daily'),
    });
  }

  // --- Wiring ---

  function setPanel(open) {
    $('panel').classList.toggle('open', open);
    $('panel-toggle').setAttribute('aria-expanded', String(open));
  }

  function changed() {
    state.dirty = true;
    setSaveState('');
    scheduleAutosave();
  }

  function wire() {
    $('story-title').addEventListener('input', (e) => {
      state.title = e.target.value;
      changed();
    });
    $('story-body').addEventListener('input', (e) => {
      state.body = e.target.value;
      paintWordCount();
      changed();
    });
    $('save').addEventListener('click', () => saveStory());
    $('download').addEventListener('click', () => {
      if (!hasText()) {
        toast('Write something first!');
        return;
      }
      downloadStory(state.title.trim() || defaultTitle(), state.body.trim());
    });
    $('post').addEventListener('click', async () => {
      await saveStory({ quiet: true });
      onPost({
        dailyDate: state.dailyDate,
        challenge: state.challenge,
        title: state.title.trim() || defaultTitle(),
        body: state.body.trim(),
      });
    });
    $('panel-toggle').addEventListener('click', () => setPanel(true));
    $('panel-close').addEventListener('click', () => setPanel(false));
    $('go-free').addEventListener('click', () => {
      setPanel(false);
      switchMode('free');
    });
    $('go-daily').addEventListener('click', () => {
      setPanel(false);
      switchMode('daily');
    });
    $('new-prompt').addEventListener('click', () => {
      setPanel(false);
      newPracticePrompt();
    });
    $('past-date').addEventListener('change', (e) => {
      const date = e.target.value;
      e.target.value = '';
      if (date >= LAUNCH_DATE && date < localDateString()) {
        setPanel(false);
        openPastDate(date);
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAutosave();
      else checkRollover();
    });
    window.addEventListener('pagehide', flushAutosave);
    setInterval(checkRollover, ROLLOVER_CHECK_MS);
    document.addEventListener('keydown', (e) => {
      if (!active || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      saveStory();
    });
  }

  async function boot() {
    wire();
    if (readSetting('lastMode', 'daily') === 'free') await openFree();
    else await openDaily();
  }

  return {
    ready: boot(),
    openStory,
    focusEditor: () => $('story-body').focus(),
    /** Whether the page is showing today's challenge. */
    isOnDaily: () => state.mode === 'daily' && !isExpired(),
    /** The challenge being shown. */
    currentChallenge: () => state.challenge,
    setActive(value) {
      active = value;
      if (!value) flushAutosave();
    },
  };
}
