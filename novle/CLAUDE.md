# CLAUDE.md — Novle

Novle is a daily short story challenge, built as a sibling of Splotchio. Everyone gets the same prompt, genre and word limit each day. People write a story, post it to a public gallery, and like each other's. It lives at **https://williamschell.dev/novle/** as a folder inside the GitHub Pages repo for williamschell.dev, with Supabase as the only backend.

Read this file before making changes. If something here conflicts with a direct instruction from William, follow William and suggest updating this file.

---

## 1. Hard constraints

The same as Splotchio, because the hosting is the same.

- **No build step.** Plain HTML, CSS and native ES modules. No bundler, TypeScript, JSX, Sass or required `package.json`.
- **No runtime npm dependencies.** The one exception is `vendor/supabase.js`, a pinned copy of `@supabase/supabase-js` 2.119.0 (MIT), loaded on demand by `api.js`.
- **Relative paths only.** The app is served from `/novle/`. Never hard-code `williamschell.dev` except in meta tags.
- **Supabase is the only backend.** All security comes from Row Level Security and database constraints, never client code. Never commit the `service_role` key.
- **Offline first.** Writing, saving, drafts and streaks must keep working if Supabase is down or not set up.
- **Stay independent of Splotchio.** Novle has its own copies of shared helpers and its own Supabase project. Never point `js/config.js` at Splotchio's project, and never import from `../splotchio/`.
- **Static and fast.** First load well under 200 KB. No analytics or trackers. Don't start file names with `_` (Jekyll ignores them).

## 2. Folder layout

```
novle/
├── index.html          # App shell
├── index.js            # Entry point: wires up views, theme and the daily prompt popup
├── css/styles.css
├── js/
│   ├── rng.js          # Seeded PRNG (same as Splotchio's)
│   ├── words.js        # Word counting and the rules for what can be posted
│   ├── daily.js        # Dates, challenge number, streak math
│   ├── prompts.js      # DRAFT prompt generator: date -> genre, word limit, prompt
│   ├── write.js        # The Write view: editor, autosave, modes, saving
│   ├── mine.js         # The Mine view: saved stories, backup and restore
│   ├── gallery.js      # Today / All-Time / single story views, posting flow
│   ├── api.js          # All Supabase calls
│   ├── config.js       # Supabase URL + anon key (public values only)
│   ├── storage.js      # IndexedDB + localStorage wrappers
│   ├── router.js       # Hash routes: #/write, #/today, #/all-time, #/mine, #/rules, #/post/:id
│   └── ui.js           # Element builder, icons, toasts, dialogs
├── assets/             # favicon.svg, icons/sprite.svg, og-image.png
├── vendor/supabase.js
├── supabase/           # schema.sql and setup README
└── tests/
    ├── index.html      # In-browser tests for the pure modules
    ├── tests.js
    └── gallery-preview.html  # The gallery on fake data, no backend needed
```

`rng`, `words`, `daily` and `prompts` must stay **pure**: no DOM and no `Math.random`.

## 3. How a day works

1. The date gives a challenge: **Novle #N**, a **genre**, a **word limit** and a **prompt**. It's computed in the browser, so it works offline and needs no server.
2. The writer writes in the Write tab. Drafts autosave to IndexedDB about once a second.
3. **Save** files the story in Mine and counts toward the streak. **Post** also saves it, then publishes it to Today's gallery.
4. A new prompt arrives at midnight, in the writer's local time, Wordle-style.

### Rules

- **Going over the limit never destroys text.** The editor keeps typing and the counter says how far over you are. Only posting is blocked. Save always works.
- **Minimum 10 words to post**, to stop empty junk. Limits live in `js/words.js` and must match the checks in `supabase/schema.sql`.
- **One post per user per day.** No editing: to change a story, delete it and post again, which also drops its likes. Otherwise someone could collect likes and swap the text.
- **Only today's prompt can be posted.** Practice and past prompts stay in Mine and don't count toward the streak.
- **Unsaved work is never lost at midnight.** A leftover draft from an earlier day is filed in Mine automatically.
- **The daily prompt popup shows once per day**, and only on the Write tab. This is a deliberate change from Splotchio's popup on every open, since writers come back to the same draft many times and a shared story link shouldn't open behind a popup.

## 4. Prompts (DRAFT: still being workshopped)

William hasn't settled how prompts should be written. `js/prompts.js` is a working draft so the rest of the game can run. **The word lists are placeholders, and it's expected that they'll be replaced.**

### What the draft does

- **Genre**: drawn from a shuffled bag, so every genre appears once before any repeats, and never twice in a row.
- **Word limit**: one of 750 to 3,000 on normal days. Sundays are always 5,000 ("long Sunday"), echoing Splotchio's Cursed Sundays.
- **Prompt**: one of two shapes:
  - Most days, a **character + situation** ("A retired stage magician gets a phone call from a number that was disconnected years ago."). Each list walks one fixed shuffle. Their lengths (31 and 25) share no factor, so a pairing can't repeat for 775 days. Keep it that way when editing the lists.
  - Every fifth day, a **first line** to start the story with. There are only 10 so far, so they start repeating after 50 days. This list needs to grow first.
- **Wrinkle**: about half of days add an optional twist ("Someone in the story is lying, and the reader finds out before the narrator does.").
- **Overrides**: `OVERRIDES` maps a date to a hand-written challenge, for holidays and special days.

### Where prompts could come from

| Option | Good | Bad |
|---|---|---|
| **A. Combining lists** (the draft) | Free, offline, endless, instant | Some combinations will be flat or odd. Needs good lists |
| **B. Hand-written calendar** (`OVERRIDES`) | The best quality | William has to write one a day, forever |
| **C. Taken from online** | Lots of material | Most prompt sites and subreddits are other people's writing, so it needs permission or a license. Public domain first lines (Project Gutenberg) are the safe version |
| **D. AI batches, reviewed by hand** | Fresh ideas, quality control | Someone has to review them. Must run offline and get committed as a file, since a browser can't hold an API key on GitHub Pages |
| **E. Community votes** | Players feel ownership | Needs a player base, moderation and new tables |

**Recommended path:** keep A as the always-working fallback, grow the lists, and use `OVERRIDES` for favorites. Then generate a month at a time with D into a reviewed file, and consider E once there's an audience. Public domain first lines from C would fit neatly into the existing first-line shape.

### Rules for changing prompts

- Changing any list **reshuffles every day**, including today and past days, for anyone who loads the new code. Ship list changes close to midnight, or start the new lists from a future date.
- Posts and saved stories store a **snapshot** of the genre, word limit and prompt they answered, so old posts always show the right prompt.
- Any new source must fit the same shape: `{ genre, wordLimit, prompt, wrinkle }`.
- Everything in the lists must be original or properly licensed.

### Known weak spot

The server can't know the day's real word limit, because prompts are computed in the browser. It checks that a story fits the `word_limit` sent with it, and that the limit is at most 5,000. A modified client could therefore claim a bigger limit or a fake prompt on its own post. Moving prompts into a database table would fix this, and would allow changing prompts without a deploy. It isn't worth it unless cheating shows up.

## 5. Public gallery

- **Tabs**: Write · Today · All-Time, plus a smaller Mine link. Hash routes, same as Splotchio.
- **Today**: today's prompt at the top, stories below, sorted by New or Top.
- **All-Time**: most-liked stories, filtered by This week / This month / All time and by genre.
- **Cards** show the title, a short excerpt, the author, word count and reading time. They never load the full text. The database keeps an `excerpt` column for this.
- **Story page** (`#/post/:id`): the full story in a serif reading layout, with the prompt it answered.
- **Identity**: Supabase anonymous sign-in, only when someone first likes, reports or posts. Optional display name, default like "Inky Heron 482".
- **Moderation**: three reports hide a post until William reviews it in the Supabase dashboard. There's no automatic text filter. All user text goes through `textContent` (via `el()`), never `innerHTML`, so stories can't inject HTML.

### Database (`supabase/schema.sql`)

The same design as Splotchio, without Storage since stories are text. The tables are `profiles`, `posts`, `likes`, `reports`, `banned_words` and `rate_events`. `posts.word_count` and `posts.excerpt` are generated by the database, so clients can't fake them. Clients can never write counters or `hidden`. Every schema change gets appended to `schema.sql` as a dated migration. Never weaken a policy to make a feature work.

## 6. Local data

- **IndexedDB** (database `novle`): `stories` for saved stories and `drafts` with one slot each for `daily` and `free`.
- **localStorage** (prefix `novle:`): theme, streak, last mode and the date of the last prompt popup.
- Mine has Export all and Import, using one JSON file.
- Storage calls never throw. Failures show a friendly message.

## 7. Look and feel

- **Light theme: light green and white. Dark theme: purple and black.** That applies to all UI, including likes and delete buttons. Colors are tokens at the top of `css/styles.css`, in two blocks (system preference and manual choice) that must stay in sync.
- Light green is too pale to hold white text, so the light theme puts dark green text on the light green bar, and uses a deeper green for solid buttons. Keep text contrast at 4.5:1 or better.
- Corners are nearly square (`--radius`), matching Splotchio.
- Story text and the prompt use a serif. Everything else uses the system UI font. No web fonts.
- The writing is the hero, and extra controls live in a side panel (a bottom sheet on phones).

## 8. Testing

Run from the **repo root** so the subpath matches production:

```bash
python -m http.server 8000
# App:     http://localhost:8000/novle/
# Tests:   http://localhost:8000/novle/tests/
# Gallery: http://localhost:8000/novle/tests/gallery-preview.html
```

`localhost` uses the `DEVELOPMENT` values in `config.js`, so testing never touches production data. Before calling a change done, run the tests page and check a narrow phone-sized viewport in both themes.

## 9. Code style

ES2022, `const`/`let`, named exports, 2-space indent, semicolons, single quotes. JSDoc on public functions. Mobile-first CSS. Every control is reachable by keyboard with a visible focus ring, icon buttons have `aria-label`, color is never the only signal, and animation respects `prefers-reduced-motion`.

## 10. Status and next steps

**Built:** editor, autosave, streaks, Mine with backup, draft prompt generator, gallery UI, posting flow, schema.

**William still needs to:**
1. Create a new Supabase project for Novle and fill in `js/config.js` (see `supabase/README.md`). Until then the gallery tabs show an offline state.
2. Set `LAUNCH_DATE` in `js/daily.js` to the real launch day. It decides which day is Novle #1.
3. Decide on the prompt plan (§4).
4. Add Novle to the main site if wanted. That's outside this folder, so ask first.

**Open questions:**
- Should you have to post before you can read today's stories, so nobody's writing gets influenced?
- Is a real-names or accounts feature ever wanted? Right now a story is tied to one browser.
- Should dark content in horror and thriller days have a content warning option?
- Should the word limit also have a daily minimum, or is 10 words enough?

## 11. Out of scope for now

Comments, following, full accounts, cloud sync of Mine, automatic moderation, rich text formatting, and any AI writing help in the app.

## 12. Working agreements for Claude

- Stay inside `novle/`. Don't touch other parts of the repo unless asked.
- Don't add dependencies, a build step or any backend beyond Supabase without asking.
- Leave the app working after every step.
- Keep this file up to date when the architecture or the prompt plan changes.
