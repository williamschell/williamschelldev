# CLAUDE.md — Splotchio

Splotchio is a browser drawing challenge. The app generates a weird organic blob, and the artist turns it into a character. Everyone gets the same daily blob, can post their character to a public gallery, and can like other people's. It lives at **https://williamschell.dev/splotchio/** as a folder inside the GitHub Pages repo for williamschell.dev, with Supabase as the only backend.

Read this file before making changes. If something here conflicts with a direct instruction from William, follow William and suggest updating this file.

---

## 1. Hard constraints

These come from how the site is hosted. Do not work around them without asking.

- **No build step.** GitHub Pages serves the files exactly as they are committed. Write plain HTML, CSS and native ES modules (`<script type="module">`). Do not use a bundler, TypeScript compilation, JSX, Sass or a `package.json` that the site needs in order to run.
- **No runtime dependencies from npm.** If a small library is truly needed, copy one pinned file into `vendor/`, add its license header and record it in §10. Prefer writing the code yourself. The project is meant to show off procedural geometry. The one planned exception is `@supabase/supabase-js`, vendored as a single pinned ESM build in `vendor/supabase.js` (§8b).
- **Relative paths only.** The app is served from the `/splotchio/` subpath, so a root-absolute path like `/assets/x.svg` points at the main site. Use `./assets/x.svg`, and import modules with `./js/...`. Never hard-code `williamschell.dev` except in meta tags.
- **Supabase is the only backend.** GitHub Pages can't run server code, so the public gallery uses a hosted Supabase project: Postgres for posts and likes, Storage for images, and anonymous Auth for identity. The browser talks to it directly using the public **anon key**. All security comes from Row Level Security policies and database constraints, never from client code. Never commit the `service_role` key or any other secret. Everything except the gallery (drawing, the personal gallery, streaks) must keep working offline or if Supabase is down.
- **Static and fast.** The first load should stay well under 200 KB, not counting fonts. No analytics or trackers.
- **Files starting with `_`** are ignored by Jekyll on GitHub Pages. Don't name anything that way, or add a `.nojekyll` file at the repo root if it becomes necessary.

## 2. Folder layout

```
splotchio/
├── index.html          # App shell. Loads css/styles.css and index.js
├── index.js            # Entry point: wires up the UI and starts the app
├── CLAUDE.md
├── css/
│   └── styles.css
├── js/
│   ├── rng.js          # Seeded PRNG + string hashing
│   ├── noise.js        # 2D value/simplex noise driven by rng
│   ├── field.js        # Scalar field: metaballs, holes, protrusions, noise warp
│   ├── contour.js      # Marching squares → closed polylines → smoothing
│   ├── path.js         # Polylines → SVG path data / Path2D (cubic Béziers)
│   ├── blob.js         # generateBlob(params) → { contours, bounds, meta }
│   ├── transform.js    # Rotate / flip / stretch / scale as a 2D matrix
│   ├── daily.js        # Date → seed, daily challenge logic, streaks
│   ├── draw.js         # Canvas drawing layer: brushes, eraser, undo/redo
│   ├── studio.js       # The Draw view: current blob, autosave, all its controls
│   ├── mine.js         # The Mine view: personal gallery, backup and restore
│   ├── upload.js       # (not built yet) Image upload, placement and opacity over the blob
│   ├── storage.js      # IndexedDB + localStorage wrappers
│   ├── export.js       # PNG / SVG / side-by-side export
│   ├── share.js        # Encode/decode blob params in the URL
│   ├── config.js       # Supabase URL + anon key (public values only)
│   ├── api.js          # All Supabase calls: auth, posts, likes, reports, storage
│   ├── gallery.js      # Today / All-time gallery views, infinite scroll
│   ├── router.js       # Hash routes: #/draw, #/today, #/all-time, #/mine, #/post/:id
│   └── ui.js           # Shared DOM helpers: elements, icons, toasts, dialogs
├── assets/
│   ├── icons/          # sprite.svg, one symbol per UI icon
│   ├── fonts/          # Self-hosted woff2 only
│   └── og-image.png    # 1200×630 social preview
├── vendor/
│   └── supabase.js     # Pinned supabase-js ESM build (see §1)
├── supabase/
│   ├── schema.sql      # Tables, constraints, triggers, RLS policies, storage rules
│   └── README.md       # How to set up the Supabase project from scratch
└── tests/
    ├── index.html      # In-browser test runner (§9)
    ├── tests.js        # The tests themselves
    └── gallery-preview.html  # The gallery on fake data, for design review with no backend
```

Keep modules small and single-purpose. Generation code (`rng`, `noise`, `field`, `contour`, `path`, `blob`, `transform`) must be **pure**: no DOM access and no `Math.random`. That keeps it deterministic and testable.

## 3. Features

### MVP (build in this order)
1. **Blob generation.** Pick a seed and parameters, get an SVG blob on screen.
2. **Controls.** Complexity, proportions, number of lobes, holes and protrusions, plus a "New blob" button.
3. **Transforms.** Rotate, flip H/V, stretch X/Y and scale, all non-destructive.
4. **Draw over the blob.** A canvas layer with a brush, an eraser, color, size and undo/redo.
5. **Save** the artwork together with the original blob, plus a local gallery to browse saved pieces.
6. **Export** a PNG of the artwork, a side-by-side PNG (blob | artwork) and an SVG of the blob alone.
7. **Daily blob.** Everyone gets the same blob on the same date, and the app tracks streaks.
8. **Public gallery** (§8b). Post today's daily artwork. Top-of-screen tabs switch between **Draw**, **Today's Gallery** and **All-Time Gallery**. Every gallery card shows the artwork **side by side with its blob**. People can like posts and report bad ones.

### After the MVP
- Uploading an image (a drawing made in another app) and lining it up over the blob.
- Share links (`?seed=…&p=…`) that rebuild the exact same blob.
- Difficulty presets (Gentle / Weird / Cursed).
- Reveal modes: show the blob as an outline only, as a filled shape, or at low opacity under the drawing.
- Pressure-sensitive brush for pen tablets (`PointerEvent.pressure`).
- Installable PWA with offline support (service worker scoped to `./`).

## 4. Blob generation

### Determinism
- Every blob comes entirely from `{ seed, params }`. The same inputs must give byte-identical path data on every browser.
- `rng.js`: hash a string seed with `cyrb128` or `xmur3`, then use `mulberry32` or `sfc32`. Export `createRng(seedString)`, which returns `{ next(), range(a,b), int(a,b), pick(arr), chance(p) }`.
- **Never call `Math.random()`** inside generation code. UI code may use it only to choose a fresh seed string.
- **Never call `Math.sin`, `cos`, `pow`, `exp`, `cbrt` or similar** in generation code. The JS spec lets them differ between engines in the last bits. Only `+ - * /`, `Math.sqrt`, `Math.floor`, `Math.round` and `Math.imul` are exact. Use precomputed constants, and `rng.unit()` for random directions.
- Round output coordinates to 2 decimal places before writing path strings.

### Pipeline
1. **Field** (`field.js`). Build a scalar field `f(x, y)` over a normalized `[-1, 1]²` space:
   - The main body is a sum of 2–N metaballs (`r² / d²`, or a smoother falloff) with random centers and radii, chained so they overlap and form one connected shape.
   - **Protrusions** are small metaballs placed along the body's edge, pushed outward.
   - **Holes** are negative metaballs placed inside the body, where the field is clearly above the threshold.
   - **Organic wobble**: warp the sample coordinates with low-frequency noise before evaluating the field.
2. **Contour** (`contour.js`). Run marching squares on a grid (about 96–160 cells per side, depending on complexity), interpolating linearly along cell edges. Join the segments into closed loops.
3. **Clean-up**:
   - By default, keep only the largest outer contour and the holes inside it, so the blob stays a single piece. A "multi-piece" option may keep extra islands above a minimum area.
   - Throw away loops below a minimum area or perimeter.
   - Simplify with Ramer–Douglas–Peucker, then smooth with 1–2 passes of Chaikin.
4. **Path** (`path.js`). Turn each loop into a closed Catmull-Rom spline converted to cubic Béziers. Outer loops run one winding direction and holes the opposite, and the path uses `fill-rule="evenodd"`.
5. **Fit**. Center the blob and scale it to fit the artboard with padding. Report `bounds` and `area` in `meta`.

### Parameters (`params`)
| key | range | meaning |
|---|---|---|
| `complexity` | 0–1 | noise strength and metaball count |
| `lobes` | 1–6 | number of main body metaballs |
| `holes` | 0–3 | negative metaballs |
| `protrusions` | 0–8 | small edge metaballs |
| `aspect` | 0.5–2 | overall stretch applied in the field |
| `smoothness` | 0–1 | Chaikin passes and the RDP tolerance |

Use defaults that give a pleasant medium blob. Presets are just named param objects.

### Quality checks (run after generation)
Regenerate with `seed + "-r1"`, `"-r2"` and so on (up to 5 tries) if the blob:
- fills less than about 8% or more than about 70% of the artboard,
- has a hole that touches the outer edge,
- is a near-circle (convex hull area ÷ blob area < 1.08 when complexity > 0.3).

The retry suffix makes this deterministic.

## 5. Rendering and layers

The stage is a fixed-aspect artboard (default 1024×1024 logical units, scaled to fit the viewport) with stacked layers:

1. Background (paper color)
2. **Blob layer**: inline `<svg>`, with the transform applied as a `matrix(...)` on a `<g>`
3. Uploaded image layer (optional): `<img>` or canvas, with position, scale and opacity
4. **Drawing layer**: `<canvas>` sized to the artboard × `devicePixelRatio`
5. UI overlays (cursor preview, selection handles)

- Transforms (`transform.js`) are stored as `{ rotate, flipX, flipY, scaleX, scaleY, scale }` and composed into one matrix. They are never baked into `contours`. Export applies the matrix.
- Once someone starts drawing, changing the blob's transform should ask for confirmation, or be locked, since the art would no longer line up.
- The blob style can be filled, outline or ghost (low opacity), with a color picker. Fill color is saved with the artwork.

## 6. Drawing

- Use Pointer Events for mouse, touch and pen. Call `setPointerCapture`, and set `touch-action: none` on the stage.
- Smooth strokes with quadratic curves between midpoints, and add pressure-based width when `pointerType === 'pen'`. There's a setting to turn pressure off.
- Pens: width tapers smoothly along each curve, the eraser end erases, and touch is ignored around pen use so a resting palm doesn't draw.
- Tools: brush, eraser (`globalCompositeOperation = 'destination-out'`), color picker, size slider, and clear (with confirmation).
- Undo/redo: keep a stack of stroke records (points + tool settings), replay them to redraw, and cache a snapshot every ~20 strokes so undo stays fast. Cap the history at around 100 steps.
- Shortcuts: `B` brush, `E` eraser, `[`/`]` size, `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo, `N` new blob (only when the canvas is empty or after confirming), `H` hide/show the blob.

## 7. Persistence

- **IndexedDB** (`storage.js`, database `splotchio`, version 1):
  - Store `artworks`: `{ id, createdAt, updatedAt, seed, params, transform, blobStyle, drawingPng: Blob, thumbPng: Blob, isDaily, dailyDate, title }`
  - Store `drafts`: the work-in-progress for the current blob, autosaved (debounced at ~1 s).
- **localStorage**, keys prefixed `splotchio:`: settings (brush defaults, theme), streak data and the last-opened view.
- Save the **seed + params** rather than the blob geometry. The blob can always be regenerated, which keeps records small. Bump a `GEN_VERSION` constant whenever the generation output changes, store it with each artwork, and keep older generator versions working (or store the path data as a fallback) so saved art still lines up after an update.
- Wrap all storage calls in try/catch. Private browsing or a full quota should show a friendly message, not break the app.
- Add "Export all" and "Import" (a JSON manifest plus PNGs in a zip, or one JSON file with data URLs) so people can back up their gallery.

## 8. Daily challenge

- The daily seed is `"daily-" + YYYY-MM-DD` using the **user's local date**, Wordle-style. Document this in the UI ("New blob at midnight").
- Daily params come from the date seed too, so difficulty varies from day to day. Optionally Sundays are "Cursed".
- Streak: count consecutive local dates with a saved daily artwork. Store `{ lastDate, current, best }`. Handle skipped days and time-zone changes gracefully (never show a negative streak).
- Show the challenge number (days since the launch date, a constant in `daily.js`), e.g. "Splotch #42".
- Past daily blobs can be opened from a calendar view, but they don't count toward the streak.

## 8b. Public gallery (Supabase)

### Navigation
- A tab bar sits at the top of the screen: **Draw · Today · All-Time**, plus a smaller **Mine** link for the person's own local gallery. Tabs use hash routes (`router.js`), so they survive refreshes and links can be shared. Hash routes also work on GitHub Pages without any 404 tricks.
- **Today**: posts for today's daily blob. The blob is shown large at the top and the posts in a grid below. Sort by **New** (default) or **Top**.
- **All-Time**: the most-liked posts across every day, ranked by like count (ties go to the earlier post), with the date and "Splotch #N" on each card. Allow filters for This week, This month and All time.
- **Blob toggle**: Today, All-Time and post pages have a "Blobs on / off" switch, remembered in localStorage. On, the card shows the blob and the art layered on that blob. Off, it shows only the drawing, as one square per card.
- **Card layout**: the blob on the left and the artwork on the right, both the same size, with the poster's display name, the like button and count, and a ⋯ menu (Report, Copy link) below. On narrow screens the card can stack, or show a toggle/slider between blob and art. Clicking a card opens `#/post/:id` as a larger view.
- The blob on a card is **not stored as an image**. It is regenerated on the client from the post's `daily_date` seed, `gen_version` and `transform`, which also proves which blob the art was drawn on. Cache generated paths per date in memory.
- Load posts in pages of 24 using keyset pagination (cursor on `like_count, created_at, id` or `created_at, id`), lazy-load thumbnails with `loading="lazy"`, and show skeleton cards while loading.

### Identity
- Use **Supabase anonymous sign-in** on first visit that needs the network. It gives each browser a stable `user_id` with no signup screen. Keep the session in Supabase's default localStorage.
- Each user may set an optional **display name** (2–24 characters, letters/numbers/spaces/`_-`, filtered against a small blocklist). The default is a generated name like "Wobbly Newt 482".
- Later (optional): link an email or OAuth account so people keep their posts across devices.

### Posting
- **Only the daily blob can be posted**, and only on its date. The server accepts `daily_date` within ±1 day of the server's UTC date to allow for time zones. Free-play blobs stay in the personal gallery.
- **One post per user per daily date**, enforced with a unique constraint. Re-posting requires deleting first (see `supabase/README.md` for why).
- Flow: the artist clicks "Post to today's gallery" and sees a confirmation step showing the preview, the display name and a short rules notice. The client uploads to Storage and then inserts the `posts` row. If the insert fails, delete the uploaded file.
- Upload a **transparent artwork-only WebP** (just the drawing, no paper or blob, so the page can layer it over the blob or show it alone) at max 1024 px and ≤ 400 KB, plus a 384 px thumbnail. The bucket enforces a file size limit and the `image/webp` / `image/png` MIME types. Storage path: `posts/{user_id}/{daily_date}/{uuid}.webp`.
- Users can delete their own posts, which also removes the images.

### Schema (`supabase/schema.sql`)
- `profiles(user_id uuid pk → auth.users, display_name text, created_at)`
- `posts(id uuid pk, user_id uuid → auth.users, daily_date date, gen_version int, transform jsonb, blob_style jsonb, image_path text, thumb_path text, like_count int default 0, report_count int default 0, hidden bool default false, created_at timestamptz default now())`, with `unique(user_id, daily_date)` and indexes on `(daily_date, created_at desc)`, `(daily_date, like_count desc)` and `(like_count desc, created_at)`.
- `likes(post_id → posts on delete cascade, user_id, created_at, primary key(post_id, user_id))`. A trigger keeps `posts.like_count` up to date. Clients never write `like_count` directly.
- `reports(post_id, user_id, reason text, created_at, primary key(post_id, user_id))`. A trigger increments `report_count` and sets `hidden = true` at **3 reports**, and William reviews hidden posts in the Supabase dashboard.
- Optionally a `top_posts` view or RPC for the all-time ranking with filters.

### Row Level Security (required on every table)
- `posts`: anyone can `select` where `hidden = false`, and owners can also see their own hidden posts. `insert` only when `user_id = auth.uid()` and `daily_date` is within the allowed window. `delete` by the owner only. No client `update` of counters or `hidden`.
- `likes`: `select` for all. `insert`/`delete` only for your own `user_id`. You can't like your own post (enforced in the policy or the trigger).
- `reports`: `insert` only for your own `user_id`. No `select` for clients.
- `profiles`: public `select` of `display_name`, and `upsert` by the owner only.
- Storage bucket `posts`: public read. Upload and delete only under `posts/{auth.uid()}/...`.
- Rate limiting: on top of the one-post-per-day rule, limit likes and reports per user per minute with a check in the trigger or an RPC. Turn on Supabase's built-in auth rate limits and CAPTCHA for anonymous sign-ins if abuse appears.

### Likes in the UI
- Toggle optimistically: update the heart and count right away, roll back if the request fails, and debounce rapid taps. Show which posts the current user liked by fetching their likes for the visible post IDs.
- Live counts are not required. Refresh on tab focus. Supabase Realtime for the Today tab is an optional extra.

### Moderation and safety
- Show short community rules before the first post: be kind, no NSFW, nothing hateful, no personal info. Link a small `#/rules` page.
- Hidden posts disappear for everyone except the owner, who sees a "Hidden pending review" label.
- Keep the anon key and project URL in `config.js`, and never ship a key with elevated rights.
- If Supabase is unreachable, show the gallery tabs with a friendly "Gallery is offline" state. Drawing and local saving must not be affected.

## 9. Testing and local development

- **Run locally from the repo root** so the subpath matches production:
  ```bash
  python3 -m http.server 8000
  # open http://localhost:8000/splotchio/
  ```
  Opening `index.html` straight from disk will not work, because ES modules need HTTP.
- **Tests**: `tests/index.html` loads the pure modules and runs simple assertions in the browser (no framework). At minimum:
  - `rng`: the same seed gives the same sequence, and different seeds give different ones.
  - `generateBlob`: fixed seeds produce identical path strings (snapshot a few in the test file, and update them deliberately when `GEN_VERSION` changes).
  - `contour`: every loop is closed, and holes wind opposite to outer loops.
  - `transform`: matrix composition, and that its inverse round-trips.
  - `daily`: streak math across month and year boundaries and skipped days.
  - `share`: encode → decode round-trips.
  - `router`: hash routes parse and resolve correctly.
- **Gallery/backend**: keep a separate Supabase project (or local `supabase start`) for development. Point `config.js` at it through a dev override (e.g. `?env=dev` or a `localhost` hostname check), never at production while testing. Check the RLS policies by trying forbidden actions from the browser console: liking twice, posting for another user, posting a non-today date, editing `like_count`, reading `reports`. Every one of these must fail.
- Before saying a change is done: run the tests page, generate at least 20 random blobs and look at them, test on a narrow mobile viewport, and draw with both mouse and touch.

## 10. Code style

- Modern JS (ES2022), with `const`/`let`, named exports and no default exports.
- Add JSDoc type comments on public functions so editors get type hints without TypeScript.
- Use 2-space indent, semicolons and single quotes.
- CSS: custom properties for theme tokens in `:root`, light and dark via `prefers-color-scheme` plus a manual toggle, and mobile-first layout.
- Accessibility: every control is reachable by keyboard and has a visible focus ring, icon buttons have `aria-label`, color is never the only signal, and animation respects `prefers-reduced-motion`.
- Comment the *math* (field falloff, marching-squares cases, spline conversion). That part is the showcase, so explain it.
- Vendored files: `vendor/supabase.js`, `@supabase/supabase-js` 2.119.0 (MIT), an esm.sh single-file bundle. It's loaded on demand by `api.js`, so it isn't part of the first load.

## 11. Look and feel

- Playful but uncluttered. The blob is the hero, and the controls live in a collapsible side panel (a bottom sheet on mobile).
- **UI palette**: blue and white in light mode, maroon and black in dark mode, for all UI including delete buttons and likes. Corners are nearly square (`--radius`). Only brush previews are round.
- Show the blob in a single bold color on a white paper background, with an ink-like default brush. The paper stays white in both themes, so art looks the same everywhere. Brush and blob colors are art, not UI, and stay colorful. The artist picks the blob color from a row beside the canvas.
- Every time the site opens, a popup tells the artist to draw whatever comes to mind.
- The wordmark "Splotchio" can itself be a blob-ish shape generated by the app.
- Make sure the main williamschell.dev site links to `/splotchio/`, and that Splotchio links back to the main site in its header or footer.

## 12. Out of scope (for now)

- Full accounts with passwords, comments and following other users.
- Syncing the personal (local) gallery to the cloud. Only posted daily art goes to Supabase.
- Automated image moderation (could be added later through a Supabase Edge Function).
- AI-generated character suggestions.
- Layers in the drawing tool beyond the single drawing canvas plus the uploaded image.

## 13. Working agreements for Claude

- Build in the MVP order in §3, one feature at a time, and leave the app working after each step.
- Stay inside `splotchio/`. Don't touch other parts of the williamschell.dev repo unless asked (adding a link to Splotchio on the homepage is the expected exception, and should be confirmed first).
- Don't add dependencies, a build step or any backend beyond Supabase without asking.
- Every schema or policy change goes into `supabase/schema.sql` (append migrations in order, with a dated comment) so the database can be rebuilt from the repo. Never weaken an RLS policy just to make a feature work.
- When changing generation output, bump `GEN_VERSION` and update the test snapshots in the same change.
- Keep this file up to date when the architecture changes.
