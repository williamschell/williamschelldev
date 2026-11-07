// Drives the real app in Chrome, with the real api.js and supabase-js talking to the real
// schema.sql in PGlite. See CLAUDE.md §9 for how to run it.

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase, supabaseShim } from './schema.mjs';

const DEPS = process.env.GT_TEST_DEPS;
if (!DEPS) throw new Error('Set GT_TEST_DEPS to a folder with playwright-core and @electric-sql/pglite installed');
const SHOTS = process.env.GT_TEST_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const ROOT = resolve(import.meta.dirname, '../..');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};

const { chromium } = await import(pathToFileURL(join(DEPS, 'node_modules/playwright-core/index.mjs')).href);
const database = await createDatabase(DEPS, join(ROOT, 'gametracker/supabase/schema.sql'));
const shim = supabaseShim(database);
const { admin, as, newUser } = database;

const requestLog = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const url = new URL(req.url, 'http://x');
    requestLog.push(url.pathname);
    if (url.pathname.startsWith('/sb/')) {
      await shim(req, res, url.pathname.slice(3), Buffer.concat(chunks).toString());
      return;
    }
    let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (file.startsWith(ROOT) && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const BASE = `http://127.0.0.1:${server.address().port}`;
const APP = `${BASE}/gametracker/`;

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failures.push(name);
    console.log(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  }
}
const same = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);

const pad = (n) => String(n).padStart(2, '0');
const dayOffset = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const TODAY = dayOffset(0);
const YESTERDAY = dayOffset(-1);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

/** A fresh browser profile. `backend` points the app at the database. */
async function player({ backend = false, viewport = { width: 1000, height: 800 } } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (backend) {
    await context.route('**/gametracker/js/config.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `export const SUPABASE = { url: '${BASE}/sb', anonKey: 'test-anon' };\nexport const BACKEND_CONFIGURED = true;`,
    }));
  }
  const page = await context.newPage();
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    // Refused requests and the offline test's aborted ones are expected, and handled by the app.
    if (msg.type() === 'error' && !/status of 4\d\d|net::ERR_FAILED/.test(msg.text())) consoleErrors.push(msg.text());
  });
  return { context, page };
}

const open = async (page, hash = '') => {
  await page.goto(`${APP}${hash}`);
  await page.waitForSelector('#view > *');
};
const go = async (page, hash) => {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(60);
};
const row = (page, id) => page.locator(`.game-row[data-game="${id}"]`);
const rowText = (page, id) => row(page, id).innerText();
const toastText = async (page) => {
  await page.waitForSelector('#toast.show');
  return page.locator('#toast').innerText();
};
const paste = async (page, text) => {
  await page.fill('.paste-box textarea', text);
  await page.click('.paste-box button');
};
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const sqlDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function rejected(promise) {
  try {
    await promise;
    return false;
  } catch {
    return true;
  }
}

/* ---------------------------- unit tests ---------------------------- */
{
  const { context, page } = await player();
  await page.goto(`${APP}tests/`);
  await page.waitForFunction(() => window.testResults);
  const results = await page.evaluate(() => window.testResults);
  for (const r of results.filter((t) => !t.ok)) console.log(`unit FAIL: ${r.name}: ${r.message}`);
  check(`unit tests (${results.length})`, results.length > 20 && results.every((t) => t.ok));
  await context.close();
}

/* ---------------------------- local only ---------------------------- */
{
  const { context, page } = await player();
  requestLog.length = 0;
  await open(page);

  same('first run lists exactly Splotchle', await page.locator('.game-row').evaluateAll((els) => els.map((e) => e.dataset.game)), ['splotchle']);
  const play = row(page, 'splotchle').locator('a.play');
  same('Splotchle links to the sibling folder', await play.getAttribute('href'), '../splotchle/');
  same('Play opens a new tab', await play.getAttribute('target'), '_blank');
  check('external links drop the opener', (await play.getAttribute('rel')).includes('noopener'));
  check('no literal "null" on the page', !(await page.locator('#view').innerText()).includes('null'));
  check('suggestions show on a short list', await page.locator('.suggestions').isVisible());
  await shot(page, '01-first-run');

  check('the Supabase client isn\'t loaded when not configured', !requestLog.some((p) => p.includes('supabase.js')));
  const firstLoad = [...new Set(requestLog)].filter((p) => p.startsWith('/gametracker/'))
    .reduce((sum, p) => sum + statSync(join(ROOT, p === '/gametracker/' ? 'gametracker/index.html' : p.slice(1))).size, 0);
  check(`first load is under 200 KB (${Math.round(firstLoad / 1024)} KB)`, firstLoad < 200 * 1024);

  // Logging by paste, including a game that isn't on the list yet.
  await paste(page, 'Wordle 1,234 3/6\n\n⬛🟨⬛⬛⬛\n🟩🟩🟩🟩🟩');
  check('paste logs and reports', (await toastText(page)).includes('Wordle: 3/6, and added'));
  check('pasted score shows', (await rowText(page, 'wordle')).includes('3/6'));
  check('paste box cleared', (await page.inputValue('.paste-box textarea')) === '');
  await paste(page, 'hello there');
  check('unknown paste explains itself', (await toastText(page)).includes('doesn\'t look like'));

  // A real paste event logs without pressing anything.
  await page.fill('.paste-box textarea', '');
  await page.focus('.paste-box textarea');
  await page.evaluate(() => navigator.clipboard.writeText('Connections\nPuzzle #123\n🟨🟨🟩🟨\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪'));
  await page.keyboard.press('Control+V');
  await page.waitForSelector('.game-row[data-game="connections"]');
  check('real paste event logs by itself', (await rowText(page, 'connections')).includes('1 mistake'));

  // Manual entry.
  await page.click('.suggestions button:has-text("The Mini")');
  await row(page, 'mini').locator('button:has-text("Log score")').click();
  await row(page, 'mini').locator('input[type=text]').fill('nonsense');
  await row(page, 'mini').locator('button:has-text("Save")').click();
  check('bad time is refused', (await toastText(page)).includes('Enter a time'));
  check('editor stays open after a bad value', await row(page, 'mini').locator('.game-editor').isVisible());
  await row(page, 'mini').locator('input[type=text]').fill('1:05');
  await row(page, 'mini').locator('button:has-text("Save")').click();
  check('time is saved', (await rowText(page, 'mini')).includes('1:05'));
  await row(page, 'splotchle').locator('button:has-text("Mark done")').click();
  check('done game marks done', (await rowText(page, 'splotchle')).includes('Done'));
  same('progress counts it', await page.locator('.progress-text').innerText(), '4 of 4 done');

  await row(page, 'wordle').locator('button:has-text("Change")').click();
  await row(page, 'wordle').locator('.choice:has-text("X")').click();
  check('failed score shows', (await rowText(page, 'wordle')).includes('X/6'));

  await row(page, 'mini').locator('button:has-text("Clear")').click();
  check('clearing puts it back to unlogged', (await rowText(page, 'mini')).includes('Log score'));

  // Other days.
  check('can\'t go past today', await page.locator('[aria-label="Next day"]').isDisabled());
  await page.click('[aria-label="Previous day"]');
  same('steps to yesterday', await page.locator('.date-label').innerText(), 'Yesterday');
  await row(page, 'mini').locator('button:has-text("Log score")').click();
  await row(page, 'mini').locator('input[type=text]').fill('50');
  await row(page, 'mini').locator('button:has-text("Save")').click();
  await page.click('[aria-label="Next day"]');
  check('other days don\'t bleed into today', (await rowText(page, 'mini')).includes('Log score'));
  await row(page, 'mini').locator('button:has-text("Log score")').click();
  await row(page, 'mini').locator('input[type=text]').fill('44');
  await row(page, 'mini').locator('button:has-text("Save")').click();
  check('two days in a row makes a streak', (await row(page, 'mini').locator('.streak-badge').innerText()).trim() === '2');
  await shot(page, '02-today-logged');

  // Everything survives a reload.
  await page.reload();
  await page.waitForSelector('.game-row');
  check('results survive a reload', (await rowText(page, 'wordle')).includes('X/6'));
  same('order survives a reload', await page.locator('.game-row').evaluateAll((els) => els.map((e) => e.dataset.game)), ['splotchle', 'wordle', 'connections', 'mini']);

  await go(page, '#/streaks');
  const miniCard = page.locator('.streak-card', { hasText: 'The Mini' });
  check('streak card shows the run', (await miniCard.locator('.stat-value').first().innerText()) === '2');
  same('calendar marks both days', await miniCard.locator('.cell.on').count(), 2);
  await shot(page, '03-streaks');

  // Managing the list.
  await go(page, '#/games');
  await page.click('[aria-label="Remove Connections from your list"]');
  check('removal offers undo', (await toastText(page)).includes('Undo'));
  check('removed game leaves the list', !(await page.locator('.manage-list').first().innerText()).includes('Connections'));
  await page.click('#toast button');
  check('undo puts it back', (await page.locator('.manage-list').first().innerText()).includes('Connections'));
  await page.click('[aria-label="Remove Connections from your list"]');
  await page.click('[aria-label="Add Connections"]');
  await go(page, '#/today');
  check('history comes back with the game', (await rowText(page, 'connections')).includes('1 mistake'));
  await go(page, '#/games');
  await page.click('[aria-label="Move Wordle down"]');
  same('reordering works', await page.locator('.manage-list').first().locator('li').evaluateAll((els) => els.map((e) => e.dataset.game)), ['splotchle', 'mini', 'wordle', 'connections']);
  check('top game can\'t move up', await page.locator('[aria-label="Move Splotchle up"]').isDisabled());
  await page.click('[aria-label="Remove Splotchle from your list"]');
  await go(page, '#/today');
  check('Splotchle can be removed like any game', await row(page, 'splotchle').count() === 0);
  await go(page, '#/games');
  await page.click('[aria-label="Add Splotchle"]');

  // Custom games, including a link that tries to run script.
  const form = page.locator('.card', { hasText: 'Add your own' });
  await form.locator('label:has-text("Name") input').fill('Bad Link');
  await form.locator('label:has-text("Link") input').evaluate((e) => { e.type = 'text'; });
  await form.locator('label:has-text("Link") input').fill('javascript:alert(1)');
  await form.locator('button[type=submit]').click();
  check('script links are refused', (await toastText(page)).includes('http'));
  const form2 = page.locator('.card', { hasText: 'Add your own' });
  await form2.locator('label:has-text("Name") input').fill('My Game');
  await form2.locator('label:has-text("Link") input').fill('https://example.com/game');
  await form2.locator('select').selectOption('points');
  await form2.locator('button[type=submit]').click();
  await go(page, '#/today');
  same('custom game gets its link', await row(page, 'c-my-game').locator('a.play').getAttribute('href'), 'https://example.com/game');
  await row(page, 'c-my-game').locator('button:has-text("Log score")').click();
  await row(page, 'c-my-game').locator('input[type=text]').fill('120');
  await row(page, 'c-my-game').locator('button:has-text("Save")').click();
  check('custom score saved', (await rowText(page, 'c-my-game')).includes('120'));

  // Backup and restore into a brand new browser.
  await go(page, '#/games');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Save a backup")')]);
  const backupPath = await download.path();
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  check('backup has the results', backup.results.some((r) => r.gameId === 'wordle' && r.failed));

  const fresh = await player();
  await open(fresh.page, '#/games');
  const tmp = join(DEPS, 'tmp-backup.json');
  writeFileSync(tmp, JSON.stringify(backup));
  await fresh.page.setInputFiles('input[type=file]', tmp);
  check('restore reports its count', (await toastText(fresh.page)).includes('Restored'));
  await go(fresh.page, '#/today');
  check('restored results show', (await rowText(fresh.page, 'wordle')).includes('X/6'));

  writeFileSync(tmp, JSON.stringify({
    app: 'gametracker',
    games: ['c-evil'],
    customGames: [{ name: 'Evil', url: 'javascript:alert(1)', kind: 'done' }],
    results: [{ gameId: 'wordle', date: '2026-02-30', score: 3 }, { gameId: 'wordle', date: dayOffset(-3), score: 99 }, { gameId: 'nope', date: TODAY, score: 1 }],
  }));
  await go(fresh.page, '#/games');
  await fresh.page.setInputFiles('input[type=file]', tmp);
  check('a tampered backup adds nothing', (await toastText(fresh.page)).includes('Restored 0'));
  check('a tampered backup can\'t add a script link', !(await fresh.page.locator('#view').innerText()).includes('Evil'));
  writeFileSync(tmp, '{not json');
  await fresh.page.setInputFiles('input[type=file]', tmp);
  check('a broken backup is refused politely', (await toastText(fresh.page)).includes('isn\'t a Streakle backup'));
  await fresh.context.close();

  // Not set up, so the social tabs say so, and offer the demo.
  await go(page, '#/compare');
  await page.waitForSelector('.empty');
  check('Compare explains that it isn\'t set up', (await page.locator('#view').innerText()).includes('isn\'t set up'));
  await go(page, '#/friends');
  check('Friends explains that it isn\'t set up', (await page.locator('#view').innerText()).includes('isn\'t set up'));

  // Theme.
  await go(page, '#/today');
  await page.click('#theme-toggle');
  const firstTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  await page.waitForSelector('.game-row');
  same('theme is remembered', await page.evaluate(() => document.documentElement.dataset.theme), firstTheme);
  await shot(page, '04-other-theme');

  check('the local-only run never called a backend', !requestLog.some((p) => p.startsWith('/sb/')));
  await context.close();
}

/* ---------------------------- Splotchle and Novle ---------------------------- */
{
  const { context, page } = await player();
  await page.goto(APP);
  await page.waitForSelector('.game-row');
  const original = JSON.stringify({ lastDate: TODAY, current: 5, best: 9 });
  await page.evaluate((v) => localStorage.setItem('splotchio:streak', v), original);
  await page.reload();
  await page.waitForSelector('.game-row');

  check('Splotchle is picked up automatically', (await rowText(page, 'splotchle')).includes('Done'));
  check('shows where it came from', (await rowText(page, 'splotchle')).includes('From Splotchle'));
  same('uses Splotchle\'s longer streak', (await row(page, 'splotchle').locator('.streak-badge').innerText()).trim(), '5');
  check('automatic results can\'t be cleared', await row(page, 'splotchle').locator('button:has-text("Clear")').count() === 0);
  same('Splotchle\'s data isn\'t changed', await page.evaluate(() => localStorage.getItem('splotchio:streak')), original);
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  check('Splotchle\'s database is never created', !dbs.includes('splotchio') && dbs.includes('gametracker'), dbs.join());

  // Coming back from Splotchle's tab after playing.
  const later = await player();
  await later.page.goto(APP);
  await later.page.waitForSelector('.game-row');
  check('not done before playing', (await rowText(later.page, 'splotchle')).includes('Mark done'));
  await later.page.evaluate((v) => {
    localStorage.setItem('splotchio:streak', v);
    window.dispatchEvent(new Event('focus'));
  }, JSON.stringify({ lastDate: TODAY, current: 1, best: 1 }));
  await later.page.waitForFunction(() => document.querySelector('.game-row[data-game="splotchle"]').innerText.includes('Done'));
  check('returning to the tab picks it up', true);
  await later.context.close();

  for (const bad of ['{broken', '{"lastDate":"nope"}', '123', 'null']) {
    await page.evaluate((v) => localStorage.setItem('splotchio:streak', v), bad);
    await page.reload();
    await page.waitForSelector('.game-row');
  }
  check('junk in Splotchle\'s key doesn\'t break anything', await row(page, 'splotchle').count() === 1);
  await context.close();
}

/* ---------------------------- demo ---------------------------- */
{
  const { context, page } = await player();
  await page.goto(`${APP}?demo#/friends`);
  await page.waitForSelector('#view form');
  check('demo says the players are made up', (await page.locator('#demo-banner').innerText()).includes('made up'));
  await page.click('button:has-text("Start comparing")');
  await page.waitForSelector('.friend-list');
  same('demo has friends', await page.locator('.friend-list li').count(), 3);
  await shot(page, '05-demo-friends');
  await go(page, '#/today');
  await page.waitForSelector('.game-row');
  await row(page, 'splotchle').locator('button:has-text("Mark done")').click();
  await page.fill('.paste-box textarea', 'Wordle 1,234 3/6');
  await page.click('.paste-box button');
  await page.waitForTimeout(1200);
  await go(page, '#/compare/wordle');
  await page.waitForSelector('.board-table');
  check('demo board ranks you', await page.locator('tr.me').count() === 1);
  await shot(page, '06-demo-board');
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  check('demo keeps to its own database', names.includes('gametracker-demo') && !names.includes('gametracker'), names.join());
  await page.goto(`${APP}#/today`);
  await page.waitForSelector('.game-row');
  check('demo results don\'t leak into real mode', await row(page, 'wordle').count() === 0);
  await context.close();
}

/* ---------------------------- real backend ---------------------------- */
const seedResult = (user, game, date, score, failed = false) => admin(`
  insert into public.results (user_id, game_id, play_date, score, failed)
  values ('${user}', '${game}', '${date}', ${score === null ? 'null' : score}, ${failed})
  on conflict (user_id, game_id, play_date) do update set score = excluded.score, failed = excluded.failed`);

{
  const a = await player({ backend: true });
  const b = await player({ backend: true });
  const c = await player({ backend: true });

  // Nothing leaves the device before joining.
  requestLog.length = 0;
  await open(a.page);
  check('the client isn\'t downloaded before joining', !requestLog.some((p) => p.includes('supabase.js')));
  await paste(a.page, 'Wordle 1,234 4/6');
  await a.page.waitForTimeout(1200);
  check('logging before joining sends nothing', !requestLog.some((p) => p.startsWith('/sb/')));
  same('nothing on the server before joining', (await admin('select count(*)::int as n from public.results'))[0].n, 0);

  // Dates inside and outside the window the server accepts, logged before joining.
  await a.page.click('[aria-label="Previous day"]');
  await paste(a.page, 'Wordle 1,233 2/6');
  for (let i = 0; i < 9; i += 1) await a.page.click('[aria-label="Previous day"]');
  await paste(a.page, 'Wordle 1,224 5/6');

  await go(a.page, '#/friends');
  await a.page.waitForSelector('button:has-text("Start comparing")');
  await a.page.locator('.card input[type=text]').fill('x');
  await a.page.click('button:has-text("Start comparing")');
  check('a bad name is caught', (await toastText(a.page)).includes('2 to 24'));
  await a.page.locator('.card input[type=text]').fill('Ada');
  await a.page.click('button:has-text("Start comparing")');
  await a.page.waitForSelector('.friend-code');
  await a.page.waitForTimeout(300);

  const aRows = await admin(`select user_id, play_date, score, failed from public.results where game_id = 'wordle' order by play_date`);
  same('joining sends the past week and not the older day', aRows.map((r) => sqlDate(r.play_date)), [YESTERDAY, TODAY]);
  same('server has the right scores', aRows.map((r) => r.score), [2, 4]);
  const aId = aRows[0].user_id;
  const code = await a.page.locator('.friend-code').innerText();
  check('friend code has the right shape', /^[0-9A-F]{10}$/.test(code), code);
  await shot(a.page, '07-account');

  // Everyone board, viewed by someone who hasn't joined.
  await open(c.page, '#/compare/wordle');
  await c.page.waitForSelector('.board-table');
  check('Everyone can be read without joining', (await c.page.locator('.board-table').innerText()).includes('Ada'));
  check('and it says you aren\'t on it', (await c.page.locator('#view').innerText()).includes('without joining'));

  // Invite link, with a name to pick first.
  await open(b.page, `#/add/${code}`);
  await b.page.waitForSelector('button:has-text("Start comparing")');
  check('invite link asks for a name first', (await b.page.locator('#view').innerText()).includes('add your friend right after'));
  await b.page.locator('.card input[type=text]').fill('Bo');
  await b.page.click('button:has-text("Start comparing")');
  await b.page.waitForSelector('.friend-code');
  same('invite code carries through', await b.page.locator('input[aria-label="Friend code"]').inputValue(), code);
  await b.page.click('.card:has-text("Add a friend") button');
  check('adding reports the friend', (await toastText(b.page)).includes('Ada'));
  await b.page.waitForSelector('.friend-list li');
  check('friend is listed', (await b.page.locator('.friend-list').innerText()).includes('Ada'));
  await go(a.page, '#/today');
  await go(a.page, '#/friends');
  await a.page.waitForSelector('.friend-list li');
  check('friendship goes both ways', (await a.page.locator('.friend-list').innerText()).includes('Bo'));

  // Bo logs and compares.
  await go(b.page, '#/today');
  await b.page.waitForSelector('.paste-box');
  await paste(b.page, 'Wordle 1,234 3/6');
  await b.page.waitForTimeout(1000);
  await go(b.page, '#/compare/wordle');
  await b.page.waitForSelector('.board-table');
  const boardRows = await b.page.locator('.board-table tbody tr').allInnerTexts();
  check('Bo ranks above Ada', boardRows[0].includes('Bo') && boardRows[1].includes('Ada'), boardRows.join('|'));
  check('rows show the score', boardRows[0].includes('3/6') && boardRows[1].includes('4/6'));
  check('your own row is marked', (await b.page.locator('tr.me').innerText()).includes('You'));
  await shot(b.page, '08-board');

  // Today shows how you stand. The cache means a fresh load.
  await open(a.page, '#/today');
  await a.page.waitForSelector('.friend-line:not([hidden])');
  same('Today shows standing', await row(a.page, 'wordle').locator('.friend-line').innerText(), '2nd of 2 with friends');
  await shot(a.page, '09-today-friends');

  // The server's streak, ranking and the client's agree.
  const dan = await newUser();
  await as(dan, `select public.save_profile('Dan', true)`);
  await seedResult(dan, 'wordle', TODAY, null, true);
  await seedResult(dan, 'wordle', YESTERDAY, 1);
  await seedResult(dan, 'wordle', dayOffset(-2), 1);
  await seedResult(dan, 'wordle', dayOffset(-4), 1);
  const eve = await newUser();
  await as(eve, `select public.save_profile('Eve', true)`);
  await seedResult(eve, 'wordle', TODAY, 3);
  const board = await as(eve, `select * from public.game_board('wordle', '${TODAY}', 'everyone', true)`);
  same('server ranks with ties and failures last', board.map((r) => [r.display_name, Number(r.rank)]), [['Bo', 1], ['Eve', 1], ['Ada', 3], ['Dan', 4]]);
  same('server streak stops at a gap', Number(board.find((r) => r.display_name === 'Dan').streak), 3);
  same('server marks you', board.filter((r) => r.is_me).map((r) => r.display_name), ['Eve']);

  const clientRanks = await a.page.evaluate(async (rows) => {
    const { rankRows } = await import('./js/scores.js');
    const { catalogGame } = await import('./js/catalog.js');
    return rankRows(catalogGame('wordle'), rows).map((r) => [r.display_name, r.rank]);
  }, board.map((r) => ({ display_name: r.display_name, score: r.score, failed: r.failed })));
  same('client and server rank the same way', clientRanks, board.map((r) => [r.display_name, Number(r.rank)]));

  const higher = await newUser();
  await as(higher, `select public.save_profile('Hi', true)`);
  await seedResult(higher, 'spelling-bee', TODAY, 200);
  await seedResult(eve, 'spelling-bee', TODAY, 50);
  const points = await as(eve, `select * from public.game_board('spelling-bee', '${TODAY}', 'everyone', false)`);
  same('higher wins on points boards', points.map((r) => r.display_name), ['Hi', 'Eve']);

  // Changing and clearing a result reaches the server.
  await go(b.page, '#/today');
  await b.page.waitForSelector('.game-row');
  await row(b.page, 'wordle').locator('button:has-text("Change")').click();
  await row(b.page, 'wordle').locator('.choice:has-text("5")').click();
  await b.page.waitForTimeout(1100);
  const bId = (await admin(`select user_id from public.profiles where display_name = 'Bo'`))[0].user_id;
  same('a change reaches the server', (await admin(`select score from public.results where user_id = '${bId}' and game_id = 'wordle'`))[0].score, 5);
  await row(b.page, 'wordle').locator('button:has-text("Clear")').click();
  await b.page.waitForTimeout(1100);
  same('clearing reaches the server', (await admin(`select count(*)::int as n from public.results where user_id = '${bId}' and game_id = 'wordle'`))[0].n, 0);
  await row(b.page, 'wordle').locator('button:has-text("Log score")').click();
  await row(b.page, 'wordle').locator('.choice:has-text("3")').click();
  await b.page.waitForTimeout(1100);
  await row(b.page, 'wordle').locator('button:has-text("Change")').click();
  await row(b.page, 'wordle').locator('.choice:has-text("6")').click();
  await row(b.page, 'wordle').locator('button:has-text("Clear")').click();
  await b.page.waitForTimeout(1100);
  same('clearing right after changing still reaches the server', (await admin(`select count(*)::int as n from public.results where user_id = '${bId}' and game_id = 'wordle'`))[0].n, 0);

  // A logged result waits out a failed request.
  await b.page.context().route('**/sb/rest/**', (route) => route.abort());
  await paste(b.page, 'Wordle 1,234 2/6');
  await b.page.waitForTimeout(1100);
  await b.page.context().unroute('**/sb/rest/**');
  await b.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await b.page.waitForTimeout(500);
  same('a result logged offline is sent later', (await admin(`select score from public.results where user_id = '${bId}' and game_id = 'wordle'`))[0]?.score, 2);

  // Errors a person can run into.
  await go(b.page, '#/friends');
  await b.page.waitForSelector('input[aria-label="Friend code"]');
  await b.page.fill('input[aria-label="Friend code"]', 'FFFFFFFFFF');
  await b.page.click('.card:has-text("Add a friend") button');
  check('unknown code explained', (await toastText(b.page)).includes('doesn\'t match anyone'));
  const bCode = await b.page.locator('.friend-code').innerText();
  await b.page.fill('input[aria-label="Friend code"]', bCode);
  await b.page.click('.card:has-text("Add a friend") button');
  await b.page.waitForFunction(() => document.querySelector('#toast').innerText.includes('your own code'));
  check('own code explained', true);

  // Going private: friends still see you, strangers don't.
  await go(a.page, '#/friends');
  await a.page.waitForSelector('.card input[type=checkbox]');
  await a.page.locator('.card input[type=checkbox]').uncheck();
  await a.page.waitForFunction(() => document.querySelector('#toast').innerText.includes('Only your friends'));
  const strangerView = await as(eve, `select display_name from public.game_board('wordle', '${TODAY}', 'everyone', true)`);
  check('a private player leaves Everyone', !strangerView.some((r) => r.display_name === 'Ada'));
  const anonView = await as(null, `select display_name from public.game_board('wordle', '${TODAY}', 'everyone', true)`);
  check('and is hidden from visitors too', !anonView.some((r) => r.display_name === 'Ada'));
  const friendView = await as(bId, `select display_name from public.game_board('wordle', '${TODAY}', 'friends', true)`);
  check('but a friend can still see them', friendView.some((r) => r.display_name === 'Ada'));

  // Rotating a code.
  await a.page.click('button:has-text("Change code")');
  await a.page.click('dialog button:has-text("Change code")');
  await a.page.waitForFunction((old) => document.querySelector('.friend-code')?.innerText !== old, code);
  const fresh = await a.page.locator('.friend-code').innerText();
  check('rotating changes the code', fresh !== code && /^[0-9A-F]{10}$/.test(fresh));
  await a.page.waitForSelector('.friend-list li');
  check('rotating keeps friends', (await a.page.locator('.friend-list').innerText()).includes('Bo'));
  const carl = await newUser();
  await as(carl, `select public.save_profile('Carl', true)`);
  same('the old code stops working', (await as(carl, `select public.add_friend('${code}') as name`))[0].name, null);

  // Copying the invite link.
  await a.page.click('button:has-text("Copy invite link")');
  await a.page.waitForFunction(() => document.querySelector('#toast').innerText.includes('copied'));
  const copied = await a.page.evaluate(() => navigator.clipboard.readText());
  check('invite link has the current code', copied.endsWith(`#/add/${fresh}`), copied);

  // Removing a friend.
  await go(b.page, '#/friends');
  await b.page.waitForSelector('.friend-list li');
  await b.page.click('[aria-label="Remove Ada"]');
  await b.page.click('dialog button:has-text("Remove")');
  await b.page.waitForFunction(() => !document.querySelector('.friend-list'));
  same('removing ends it for both', (await admin('select count(*)::int as n from public.friendships'))[0].n, 0);
  const afterRemoval = await as(bId, `select display_name from public.game_board('wordle', '${TODAY}', 'everyone', true)`);
  check('a removed private friend disappears', !afterRemoval.some((r) => r.display_name === 'Ada'));

  /* ---------------------------- forbidden actions, straight at the database ---------------------------- */
  check('can\'t save as someone else', await rejected(as(eve, `insert into public.results (user_id, game_id, play_date, score) values ('${dan}', 'hack', '${TODAY}', 1)`)));
  check('can\'t save a far-off date', await rejected(as(eve, `select public.save_results('[{"game_id":"wordle","play_date":"2020-01-01","score":1}]')`)));
  check('can\'t save far in the future', await rejected(as(eve, `select public.save_results('[{"game_id":"wordle","play_date":"2099-01-01","score":1}]')`)));
  check('can\'t save a junk game id', await rejected(as(eve, `select public.save_results('[{"game_id":"<script>","play_date":"${TODAY}","score":1}]')`)));
  check('can\'t save an absurd score', await rejected(as(eve, `select public.save_results('[{"game_id":"wordle","play_date":"${TODAY}","score":-5}]')`)));
  await as(eve, `update public.results set score = 1 where user_id = '${dan}'`);
  same('can\'t change someone else\'s result', (await admin(`select score from public.results where user_id = '${dan}' and play_date = '${TODAY}'`))[0].score, null);
  await as(eve, `delete from public.results where user_id = '${dan}'`);
  same('can\'t delete someone else\'s result', (await admin(`select count(*)::int as n from public.results where user_id = '${dan}'`))[0].n, 4);
  same('can only read your own friend code', (await as(eve, 'select user_id from public.friend_codes')).map((r) => r.user_id), [eve]);
  same('visitors can\'t read codes', await rejected(as(null, 'select * from public.friend_codes')), true);
  check('can\'t create a friendship directly', await rejected(as(eve, `insert into public.friendships (user_a, user_b) values ('${dan < eve ? dan : eve}', '${dan < eve ? eve : dan}')`)));
  check('can\'t unban yourself', await rejected(as(eve, `update public.profiles set banned = false where user_id = '${eve}'`)));
  await as(eve, `update public.profiles set display_name = 'Pwned' where user_id = '${dan}'`);
  same('can\'t rename someone else', (await admin(`select display_name from public.profiles where user_id = '${dan}'`))[0].display_name, 'Dan');
  check('can\'t read the blocklist', await rejected(as(eve, 'select * from public.banned_words')));
  check('can\'t read the rate log', await rejected(as(eve, 'select * from public.rate_events')));
  check('can\'t call internals directly', await rejected(as(eve, `select public.check_rate('x', 1)`)));
  check('visitors can\'t add friends', await rejected(as(null, `select public.add_friend('ABC')`)));
  check('visitors can\'t save results', await rejected(as(null, `select public.save_results('[]')`)));
  check('visitors can\'t list friends', await rejected(as(null, 'select * from public.list_friends()')));
  check('bad characters in a name are refused', await rejected(as(eve, `select public.save_profile('<img src=x>', true)`)));
  await admin(`insert into public.banned_words (word) values ('rude')`);
  check('blocklisted names are refused', await rejected(as(eve, `select public.save_profile('So Rude', true)`)));

  // Guessing codes is rate limited.
  const guesser = await newUser();
  await as(guesser, `select public.save_profile('Guesser', true)`);
  let limited = false;
  for (let i = 0; i < 12 && !limited; i += 1) {
    try {
      await as(guesser, `select public.add_friend('0000000000')`);
    } catch (err) {
      limited = err.code === 'P0429';
    }
  }
  check('guessing codes hits the rate limit', limited);

  // Banning.
  await admin(`update public.profiles set banned = true where user_id = '${dan}'`);
  const afterBan = await as(eve, `select display_name from public.game_board('wordle', '${TODAY}', 'everyone', true)`);
  check('a banned player leaves the boards', !afterBan.some((r) => r.display_name === 'Dan'));
  const danCode = (await admin(`select code from public.friend_codes where user_id = '${dan}'`))[0].code;
  same('a banned player can\'t be friended', (await as(eve, `select public.add_friend('${danCode}') as name`))[0].name, null);

  // A session from Splotchle on this same origin isn't mistaken for ours.
  const other = await player({ backend: true });
  await other.page.goto(APP);
  await other.page.waitForSelector('.game-row');
  await other.page.evaluate(() => localStorage.setItem('sb-splotchle-project-auth-token', '{"fake":true}'));
  requestLog.length = 0;
  await other.page.reload();
  await other.page.waitForSelector('.game-row');
  await other.page.waitForTimeout(300);
  check('another project\'s session is ignored', !requestLog.some((p) => p.includes('supabase.js')));
  await other.context.close();

  // A session survives a reload.
  await a.page.reload();
  await a.page.waitForSelector('.friend-code');
  check('still signed in after a reload', true);

  // Leaving.
  await a.page.click('button:has-text("Delete my shared data")');
  await a.page.click('dialog button:has-text("Delete")');
  await a.page.waitForSelector('button:has-text("Start comparing")');
  same('leaving deletes the results', (await admin(`select count(*)::int as n from public.results where user_id = '${aId}'`))[0].n, 0);
  same('leaving deletes the profile', (await admin(`select count(*)::int as n from public.profiles where user_id = '${aId}'`))[0].n, 0);
  await go(a.page, '#/today');
  await a.page.waitForSelector('.game-row');
  check('local history stays after leaving', (await rowText(a.page, 'wordle')).includes('4/6'));

  // Rejoining sends it all again.
  await go(a.page, '#/friends');
  await a.page.waitForSelector('button:has-text("Start comparing")');
  await a.page.locator('.card input[type=text]').fill('Ada Again');
  await a.page.click('button:has-text("Start comparing")');
  await a.page.waitForSelector('.friend-code');
  await a.page.waitForTimeout(300);
  const again = await admin(`select r.score from public.results r join public.profiles p using (user_id) where p.display_name = 'Ada Again' and r.game_id = 'wordle' order by r.play_date`);
  same('rejoining resends the past week', again.map((r) => r.score), [2, 4]);

  await a.context.close();
  await b.context.close();
  await c.context.close();
}

/* ---------------------------- phones ---------------------------- */
{
  const { context, page } = await player({ viewport: { width: 340, height: 700 } });
  await page.goto(`${APP}?demo#/friends`);
  await page.waitForSelector('#view form');
  check('fits a phone: join', await noOverflow(page));
  check('fits a phone: all five tabs are on screen', await page.locator('.tab').evaluateAll((tabs) => tabs.length === 5
    && tabs.every((tab) => tab.getBoundingClientRect().right <= window.innerWidth)));
  await page.click('button:has-text("Start comparing")');
  await page.waitForSelector('.friend-code');
  check('fits a phone: friends', await noOverflow(page));
  await go(page, '#/games');
  check('fits a phone: games', await noOverflow(page));
  for (const label of ['Add Wordle', 'Add Connections', 'Add The Mini']) await page.click(`[aria-label="${label}"]`);
  await go(page, '#/today');
  await page.waitForSelector('.game-row');
  await row(page, 'wordle').locator('button:has-text("Log score")').click();
  check('fits a phone: today', await noOverflow(page));
  await shot(page, '10-phone-today');
  await row(page, 'wordle').locator('.choice:has-text("3")').click();
  await go(page, '#/streaks');
  check('fits a phone: streaks', await noOverflow(page));
  await page.waitForTimeout(900);
  await go(page, '#/compare/wordle');
  await page.waitForSelector('.board-table');
  check('fits a phone: compare', await noOverflow(page));
  await shot(page, '11-phone-compare');
  await context.close();
}

same('no errors in the browser console', consoleErrors, []);

await browser.close();
await database.db.close();
server.close();
console.log(`\n${passed}/${passed + failures.length} passed`);
process.exit(failures.length === 0 ? 0 : 1);
