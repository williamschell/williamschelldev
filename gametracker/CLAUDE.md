# CLAUDE.md — Streakle (game tracker)

Streakle is a tracker for daily web games like Wordle and Splotchle. You keep a list of the games you play, jump to each one from a single page, log your result, keep streaks, and compare scores with friends and other players. It lives at **https://williamschell.dev/gametracker/** as a folder inside the GitHub Pages repo for williamschell.dev, with Supabase as the only backend.

"Streakle" is a working name. It only appears in `index.html`, `index.js` and this file, so it's cheap to change. Storage keys say `gametracker` so a rename never orphans anyone's data.

Read this file before making changes. If something here conflicts with a direct instruction from William, follow William and suggest updating this file.

---

## 1. Hard constraints

The same as Splotchle and Novle, because the hosting is the same.

- **No build step.** Plain HTML, CSS and native ES modules. No bundler, TypeScript, JSX, Sass or required `package.json`.
- **No runtime npm dependencies.** The one exception is `vendor/supabase.js`, a pinned copy of `@supabase/supabase-js` 2.119.0 (MIT), loaded on demand by `api.js`.
- **Relative paths only.** The app is served from `/gametracker/`. Never hard-code `williamschell.dev` except in meta tags.
- **Supabase is the only backend.** All security comes from Row Level Security and database constraints, never client code. Never commit the `service_role` key.
- **Local first.** The list, logging and streaks must keep working if Supabase is down, not set up, or the person never makes an account. Nothing is uploaded until they sign in.
- **Its own Supabase project and its own copies of shared helpers.** Never point `js/config.js` at Splotchle's or Novle's project, and never import from `../splotchle/`.
- **Static and fast.** First load well under 200 KB. No analytics or trackers. Don't start file names with `_` (Jekyll ignores them).

## 2. Folder layout

```
gametracker/
├── index.html          # App shell
├── index.js            # Entry point: routes, theme, refreshing on focus and at midnight
├── css/styles.css
├── js/
│   ├── dates.js        # Local dates and day arithmetic (pure)
│   ├── streaks.js      # Streak math (pure)
│   ├── scores.js       # Formatting, comparing, ranking and validating scores (pure)
│   ├── catalog.js      # The built-in games and the rules for custom games (pure)
│   ├── parse.js        # Reads pasted share text into a result (pure)
│   ├── external.js     # Reads Splotchle's and Novle's streaks from this origin (§5)
│   ├── store.js        # The game list and results, in IndexedDB and localStorage, plus sync
│   ├── backend.js      # Picks the real backend or the demo one
│   ├── api.js          # All Supabase calls
│   ├── demo.js         # A fake backend with made-up players, for ?demo
│   ├── config.js       # Supabase URL + anon key (public values only)
│   ├── router.js       # Hash routes
│   ├── ui.js           # Element builder, icons, toasts, dialogs
│   └── views/          # today, compare, streaks, friends, games, account
├── assets/             # favicon.svg, icons/sprite.svg, fonts/ (Patrick Hand + OFL.txt)
├── vendor/supabase.js
├── supabase/           # schema.sql and setup README
└── tests/
    ├── index.html      # In-browser tests for the pure modules
    ├── tests.js
    ├── schema.mjs      # Loads schema.sql into PGlite with a stand-in for Supabase's auth
    └── e2e.mjs         # Drives the real app and the real SQL in Chrome (§9)
```

`dates`, `streaks`, `scores`, `catalog` and `parse` must stay **pure**: no DOM, no storage and no network.

## 3. Features

- **Today** (`#/today`): every game on your list with a Play link, your result, your streak and how you stand against friends. A box takes pasted share text and works out the game and score by itself. You can step back through earlier days to log something you missed.
- **Compare** (`#/compare`): a ranked board for one game on one day, for Friends or Everyone.
- **Streaks** (`#/streaks`): your overall streak, plus current, best, total and a 12-week calendar for each game.
- **Friends** (`#/friends`): share a friend code or link, add and remove friends. `#/add/CODE` opens this view with the code filled in. Signed out, it sends you to Account via `#/account/add/CODE`, which comes back here afterwards.
- **Games** (`#/games`): add and remove games, reorder them, add custom games, and back up or restore everything as a JSON file.
- **Account** (`#/account`, from the top bar): sign in or make an account with a username and password, then set your board name, opt out of Everyone, change your password, sign out or delete the account.

**Splotchle and Krillion are on everyone's list by default** (`DEFAULT_GAMES`). They can still be removed like any other game and added back. Defaults only apply to a list that has never been saved, so changing them doesn't touch existing players' lists.

Krillion, Enclose Horse and Farflung are `points` games with no paste parser, because their share text hasn't been checked yet. Add parsers once someone pastes a real result.

## 4. Scores

Every game has a `kind`, and a result is `{ score, failed }`:

| kind | better | example | notes |
|---|---|---|---|
| `guesses` | lower | `3/6`, `X/6` | has `max` |
| `count` | lower | `2 mistakes` | has `unit` |
| `time` | lower | `1:23` | seconds |
| `points` | higher | `142`, `4/5 stars` | optional `max` and `unit` |
| `done` | none | `Done` | `score` is null, everyone ties |

Failed results rank below every finished one. Ties share a rank (1, 2, 2, 4). The same rule exists twice, in `rankRows` in `scores.js` and in `game_board` in `schema.sql`, and the e2e test checks they agree.

To add a game, add it to `CATALOG` in `catalog.js`, and add a parser in `parse.js` if it has share text. Add a real sample to `tests/tests.js` too. **The parsers were written from known formats, so check each one against real share text when you can**, and treat a mismatch as a bug. Manual entry always works.

Custom games get the id `c-<slug of name>`, so two people who add a game with the same name share a board. A custom game's link is saved to its owner's account but never shown to anyone else, and only `http:` and `https:` URLs are accepted, so a link can't run script. Custom games coming back from the server are rebuilt through `makeCustomGame` like typed ones.

## 5. Splotchle and Novle

They share this origin, so `external.js` can read their localStorage: `splotchio:streak` and `novle:streak`, both `{ lastDate, current, best }`. When one says you played, it's logged automatically as a `done` result, and the streak shown is the higher of theirs and ours, since theirs may go back further.

- **Read only.** Never write to their keys.
- **Never open their IndexedDB databases.** Opening a database that doesn't exist creates it empty at version 1, so their upgrade code would never run and their app would break.
- This only works on the same origin, so it won't work across different ports locally.

## 6. Local data

- IndexedDB database `gametracker`, store `results`, key `gameId|date`: `{ gameId, date, score, failed, source, updatedAt, synced, deleted }`. Everything is loaded into memory at startup.
- localStorage, prefix `gametracker:`: `games` (ordered ids), `customGames`, `theme`, `account` (`{ username }`, which browser is signed in to what, so signed-out visits never load the Supabase client), and the sync state `pulledAt`, `listVersion` and `listDirty`.
- `?demo` uses `gametracker-demo` and `gametracker-demo:` instead, so demo play never touches real data.
- Storage failures show a toast and never throw.
- Clearing a synced result leaves a `deleted` tombstone until the server has been told.
- **Signed in, the account is the lasting copy and the browser is a cache of it** (`store.js`, sync section). Changes go up within a second. Other devices' changes come down on open and on returning to the tab, at most every 20 s. A change not yet sent always beats the server's copy. Signing in merges the browser into the account, signing out clears the browser, and deleting the account leaves the history in the browser.

Dates are the person's **local** date, Wordle-style. A result belongs to the day it was logged for, not to a puzzle number.

## 7. Backend

See `supabase/schema.sql` and `supabase/README.md`.

- **Accounts are a username and password, with no email**, kept in our own tables (`accounts`, `sessions`) rather than Supabase Auth, whose password sign-in needs a real email. Each browser has an anonymous Supabase session that's only a device id. `sign_in` links it to an account, and **`public.me()` is the player everywhere, never `auth.uid()`**, except for per-device rate limits. Passwords are bcrypt through `pgcrypto` and never leave the definer functions. A forgotten password is reset by William in SQL (README).
- **History is all synced**: every result from 2015 on, the game list and custom games. A result written more than a week after its day is `backfilled` and kept off boards, so past boards can't change. Cleared results stay as `deleted` tombstones so other devices hear about them. Boards always filter both.
- **Only numbers and the list go to the server**: game id, date, score, failed, and the list with custom games' names and links (readable only by their owner). Share text and grids stay local, so a board can't spoil anyone's puzzle.
- **Friends are mutual and code-based.** Having someone's code is the consent, so there's no search and no request inbox. Codes are private to their owner and can be changed, which invalidates old links but keeps existing friends.
- **Scores are self-reported and can't be verified**, because the games are on other sites. Treat Everyone as for fun. The lever against cheaters is `profiles.banned`, set from the dashboard.
- The client only uses RPCs. They're `security invoker` wherever possible, so RLS still applies inside them. The account functions, `me`, `my_account`, `add_friend`, `rotate_friend_code` and the trigger functions are `security definer` with an empty search path. Anything that can fail on a guess (`sign_in`, `add_friend`) returns a value instead of raising, because raising rolls back the record of the attempt.

## 8. Demo mode

`?demo` swaps in `js/demo.js`, a fake backend with made-up players, so the social views can be seen with no Supabase project. A banner always says the players aren't real. It's loaded on demand and adds nothing to the normal first load.

## 9. Testing and local development

Run from the repo root so the subpath matches production:

```
python -m http.server 8000
# http://localhost:8000/gametracker/          local features only until DEVELOPMENT is set in config.js
# http://localhost:8000/gametracker/?demo     with fake players
# http://localhost:8000/gametracker/tests/    unit tests
```

`tests/e2e.mjs` needs Chrome plus two packages kept outside the repo:

```
npm install --prefix <somewhere> playwright-core @electric-sql/pglite
$env:GT_TEST_DEPS = '<somewhere>'; node gametracker/tests/e2e.mjs
```

It runs the app with the real `api.js` and the real supabase-js against the real `schema.sql` in PGlite. A small shim stands in for Supabase's auth and PostgREST, including its roles, so RLS is really enforced. It's still not a real Supabase project, so try the forbidden actions in `supabase/README.md` on a development project too.

## 10. Code style

- ES2022, `const`/`let`, named exports only, JSDoc on public functions, 2-space indent, semicolons, single quotes.
- Build DOM with `el()`, which never parses HTML, so names from other players are safe.
- CSS: custom properties in `:root`, light and dark through `prefers-color-scheme` plus a manual toggle, mobile first.
- **Look: a spiral notepad on a desk.** Ruled paper with a red margin, a cardboard top with the sections as tabs, handwriting (Patrick Hand, self-hosted in `assets/fonts/` under the OFL, latin subset only) and controls drawn in pen. Games on Today are a to-do list with tick boxes, and streak cards and dialogs are index cards. **Anything that adds to a list is a sticky note with a thumbtack** (`.sticky-note` for the Games board, `.sticky-button` for single buttons). Notes that aren't buttons are taped on, not pinned. Light mode is navy ink on cream paper; dark mode is the pad at night, with a maroon top and margin on near-black paper.
- Every control works by keyboard with a visible focus ring, icon buttons have `aria-label`, color is never the only signal, and animation respects `prefers-reduced-motion`.

## 11. Out of scope (for now)

- Reading scores from other sites automatically. Browsers don't allow it, and these games don't offer APIs. A browser extension is the only real route.
- Email, password reset by email, push notifications and reminders.
- Group leaderboards beyond one friend list, and all-time rankings.
- Chat, comments and reactions. Names are the only text any player can show another.

## 12. Working agreements for Claude

- Stay inside `gametracker/`. Linking it from the homepage (`js/projects.js`) should be confirmed first. Splotchle and Novle are only ever read from, never edited, for this project.
- Every schema or policy change goes into `supabase/schema.sql` as a dated migration at the bottom. Never weaken an RLS policy to make a feature work.
- Don't add dependencies, a build step or another backend without asking.
- Keep this file up to date when the architecture changes.
