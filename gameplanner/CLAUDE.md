# CLAUDE.md — Game Planner

Game Planner is a notepad for planning a video game: a game design document (GDD), a kanban board of to-dos split into art, programming, design and audio, and exports of both. It lives at **https://williamschell.dev/gameplanner/** as a folder inside the GitHub Pages repo for williamschell.dev. It has no backend: everything is kept in the browser.

Read this file before making changes. If something here conflicts with a direct instruction from William, follow William and suggest updating this file.

## 1. Hard constraints

- **No build step.** Plain HTML, CSS and native ES modules. No bundler, TypeScript, JSX or required `package.json`.
- **No runtime dependencies and no backend.** Data is kept in localStorage. Adding accounts or sync is a conversation with William first.
- **Relative paths only.** The app is served from `/gameplanner/`. Never hard-code `williamschell.dev` except in meta tags.
- **Its own copies of shared helpers.** Never import from `../gametracker/` or other apps, even where code is the same (`ui.js` started as a copy of Streakle's).
- **Static and fast.** No analytics or trackers. Don't start file names with `_` (Jekyll ignores them).

## 2. Folder layout

```
gameplanner/
├── index.html          # App shell: top bar with tabs, the open game, theme toggle
├── index.js            # Entry point: routes, theme, top bar
├── css/styles.css
├── js/
│   ├── model.js        # Data shapes, cleaning, card ordering, the GDD template (pure)
│   ├── export.js       # Markdown, text and CSV for to-dos; Markdown for the GDD (pure)
│   ├── router.js       # Hash routes (parseHash is pure)
│   ├── store.js        # localStorage, the open game, every change
│   ├── ui.js           # Element builder, icons, toasts, dialogs, download, copy, print
│   └── views/          # gdd, board, export, games
├── assets/             # favicon.svg, icons/sprite.svg, fonts/ (Patrick Hand + OFL.txt)
└── tests/              # index.html + tests.js for the pure modules
```

`model.js` and `export.js` must stay **pure**: no DOM, no storage and no network.

## 3. Features

- **GDD** (`#/gdd`): an index card with the title, pitch, stage, genre, platforms, audience and tools, then a contents list with word counts, then the sections (the template is `GDD_TEMPLATE`). Sections can be renamed, added, moved and removed (with undo). Everything saves as it's typed.
- **To-dos** (`#/todos`, `#/todos/<discipline>`): four columns (Backlog, To do, Doing, Done). Each to-do is a sticky note colored by discipline, with a thumbtack colored by priority (red high, blue normal, green low; the priority is also written on the note). Notes move by drag and drop or by the arrow buttons on each note, which work by keyboard and touch. The filters show one discipline at a time. A card can have notes, a priority and a due date, and overdue cards say so.
- **Export** (`#/export`): to-do lists filtered by discipline and column, grouped by discipline or column, as a Markdown checklist, plain text or CSV. Copy, download or print. The GDD can be copied, downloaded or printed as Markdown. Backups are a JSON file of every game. Restoring asks whether to replace or keep games that are already here.
- **Games** (`#/games`): several games, each with its own GDD and board. Open, rename, delete, or start a new one. The open game's name is in the top bar.

## 4. Data

- localStorage, prefix `gameplanner:`: `data` (`{ projects, currentId }`), `theme`, `export` (the export choices) and `lastDiscipline`.
- A project is `{ id, name, createdAt, updatedAt, meta, sections[], cards[] }`. The order of `cards` is the order on the board. `placeCard` and `shiftCard` in `model.js` are the only ways that order changes.
- Everything read from storage or a backup goes through `cleanData`/`cleanProject`/`cleanCard`, so bad data is repaired, not trusted.
- Saves happen 300 ms after a change, and right away when the page is hidden. A failed save shows a toast and never throws. Another tab's save is picked up through the `storage` event.

## 5. Look

The same notepad as Streakle (see `gametracker/CLAUDE.md` §10): ruled paper with a red margin, a cardboard top with the sections as tabs, Patrick Hand, and controls drawn in pen. Light mode is navy on cream, dark mode is maroon on near-black. Things that add to a list are sticky notes with thumbtacks. The overview and dialogs are index cards. GDD text is written on its own ruled lines. Discipline colors are `--art`, `--programming`, `--design` and `--audio`, and a label always goes with the color. The page widens to 1280 px on the board.

Every control works by keyboard with a visible focus ring, icon buttons have `aria-label`, and animation respects `prefers-reduced-motion`. Views redraw through `redrawKeepingFocus`, which puts focus back by `data-focus`.

## 6. Testing

Run from the repo root so the subpath matches production:

```
python -m http.server 8000
# http://localhost:8000/gameplanner/
# http://localhost:8000/gameplanner/tests/
node gameplanner/tests/tests.js     # the same tests, without a browser
```

## 7. Working agreements for Claude

- Stay inside `gameplanner/`. Linking it from the homepage should be confirmed with William first.
- Don't add dependencies, a build step or a backend without asking.
- Keep this file up to date when the architecture changes.
