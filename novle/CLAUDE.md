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
│   ├── prompts.js      # Prompt generator: date -> genre, word limit, prompt
│   ├── prompt-bank.js  # All the prompt content. Edit this one to change prompts
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

`rng`, `words`, `daily`, `prompts` and `prompt-bank` must stay **pure**: no DOM and no `Math.random`.

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

## 4. Prompts

`js/prompts.js` decides what each day gets. `js/prompt-bank.js` holds all the content and is the file to edit. Reedsy, Writer's Digest and creativewritingprompts.com were studied for what makes a prompt work. **Their prompts are not copied, and nothing from them should be pasted in.**

### What makes a good prompt

- **One concrete hook, then get out of the way.** Leave the plot and the ending to the writer.
- **Many shapes.** The same sentence pattern every day gets stale fast.
- **The genre has to matter.** It's either in the sentence or the prompt was written for it.
- **Don't assign a job or a name** unless that's the point of the idea.
- **A short name** gives the prompt personality.

### How a day is built

- **Genre**: drawn from a shuffled bag, so every genre appears once before any repeats, and never twice in a row.
- **Word limit**: one of 750 to 3,000 on normal days. Sundays are always 5,000.
- **Shape**: `SHAPE_ORDER` repeats every 13 days. It's 13 because that shares no factor with the 7-day week or the 14 genres, so every genre meets every shape.

| Shape | Share | Example |
|---|---|---|
| `scenario` | 5 of 13 | Hand-written for the genre: "The ring has thirteen keys, and the building has twelve doors." |
| `opening` | 1 of 13 | Start a western with this line: "..." |
| `closing` | 1 of 13 | Write a thriller that ends with this exact line: "..." |
| `spoken` | 1 of 13 | Write a romance in which someone has to say: "..." |
| `pov` | 1 of 13 | Write a mystery from the point of view of the getaway driver. |
| `form` | 1 of 13 | Tell a fairy tale entirely as a court transcript. |
| `gathering` | 1 of 13 | Set a noir story at a wedding, and let something go wrong. |
| `object` | 1 of 13 | Build a comedy around a key that fits nothing. |
| `words` | 1 of 13 | Write a horror story that uses all four of these words: ... |

- **Optional twist**: about a third of days on the `scenario`, `object`, `gathering` and `spoken` shapes. Half are general and half ban the genre's most tired words ("Don't use any of these words: "love", "heart"..."), unless the prompt itself uses one of them. The other shapes already have a strict rule, so they never get one. A twist must never decide the form, the narrator or the ending, since it could clash with a shape.
- **Overrides**: `OVERRIDES` maps a date to a hand-written challenge, for holidays and special days.

### Rules for changing prompts

- **Changing a list reshuffles the days that use it**, including today, for anyone who loads the new code. Ship list changes close to midnight.
- Adding a whole genre also changes `GENRES`, which reshuffles the genre of every day.
- Posts and saved stories store a **snapshot** of the genre, word limit and prompt they answered, so old posts always show the right prompt.
- Each genre needs at least 8 scenarios, and uses them all before repeating one. With 8 each, the same prompt typically comes back after about 10 months (130 days at the very soonest, across all shapes), so adding more is the best way to improve the game over time.
- Generic items must work in any genre and any era. Nothing like "a voicemail", which breaks a western.
- Everything must be original or properly licensed.

### Where more prompts could come from

- **Hand-written** (best): add to `prompt-bank.js`, or use `OVERRIDES` for one day.
- **AI batches, reviewed by hand**: must run offline and get committed as a file, since a browser can't hold an API key on GitHub Pages.
- **Public domain first lines** (Project Gutenberg) would fit the `opening` shape. Most prompt sites and subreddits are other people's writing and need permission.
- **Community votes**: needs a player base, moderation and new tables.
- **Weekly themes**: Reedsy groups its prompts under a weekly theme, which could be a fun later addition.

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

**Built:** editor, autosave, streaks, Mine with backup, prompt generator, gallery UI, posting flow, schema.

**William still needs to:**
1. Create a new Supabase project for Novle and fill in `js/config.js` (see `supabase/README.md`). Until then the gallery tabs show an offline state.
2. Set `LAUNCH_DATE` in `js/daily.js` to the real launch day. It decides which day is Novle #1.
3. Keep growing the prompt bank (§4).
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
