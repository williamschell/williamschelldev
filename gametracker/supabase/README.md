# Setting up Streakle on Supabase

The app works without any of this. Until `js/config.js` is filled in, your list, logging and streaks work as normal in the browser, and the Account, Compare and Friends tabs say comparing isn't set up.

Streakle gets its own project, separate from Splotchle's and Novle's. Make one for production, and ideally a second for development, and repeat these steps for each.

## Steps for a new project

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. These aren't accounts. Each browser gets one as a device id, and signing in links it to an account (see below).
3. Open the **SQL editor**, paste in all of [schema.sql](schema.sql), and run it.
4. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into [../js/config.js](../js/config.js). Production values go in `PRODUCTION` and development values in `DEVELOPMENT`. The app uses `DEVELOPMENT` on `localhost` and `127.0.0.1`, and `PRODUCTION` everywhere else.

Never copy the `service_role` key anywhere in this repo. It bypasses all of the security rules.

## Updating a project that already has the schema

`schema.sql` is the original schema followed by dated migrations. Run only the migrations newer than what the project has, in order, in the SQL editor. Each one starts with a `-- ====` banner and a date.

**2026-11-07: username and password accounts.** Run everything from that banner to the end of the file. It **removes players made with the old no-signup system**, with their shared scores and friendships. Their history is still in their browsers, and it uploads again when they make an account.

**2026-11-07: overall board.** Adds `day_board`, which the overall board on Compare reads. It's safe to run again. If you already ran the accounts migration, run just this one.

## Accounts

Accounts are a username and a password, with no email. They live in this database rather than in Supabase Auth, because Supabase's password sign-in needs a real email address.

- Each browser has an anonymous Supabase session that's only a device id. `sign_in` checks the password and links that device to the account in `public.sessions`, and `public.me()` turns the device into the account. Every policy uses `me()`.
- Passwords are hashed with bcrypt (`pgcrypto`, cost 10) and are 8 to 72 bytes. Usernames are 3 to 20 lowercase letters, digits or `_`, and are also the starting display name, so the name blocklist applies to them.
- Ten wrong passwords in 15 minutes locks a username for 15 minutes. Someone could use that to keep a friend locked out. If it happens, wait it out or clear the lock below.
- Changing a password signs out every other device. Deleting an account removes everything, and frees the username.

**Resetting a forgotten password.** Pick a temporary password, run this in the SQL editor, and tell them to change it on the Account page:

```sql
update public.accounts
set password_hash = extensions.crypt('temporary password here', extensions.gen_salt('bf', 10)),
    failed_logins = 0, locked_until = null
where username = 'their_username';
```

**Clearing a lock** is the same, without the `password_hash` line.

**Old anonymous users** pile up in **Authentication → Users** as people use new browsers. They hold nothing, and Supabase can be set to clean them up.

## Check the security rules

`tests/e2e.mjs` checks these against the real schema in PGlite, but not on Supabase itself, so run them once on your **development** project from the browser console. Every one of them must fail or change nothing. To get a client signed in as a device without an account:

```js
const { createClient } = await import('./vendor/supabase.js');
const { SUPABASE } = await import('./js/config.js');
const db = createClient(SUPABASE.url, SUPABASE.anonKey);
await db.auth.signInAnonymously();
```

| Try this | How to run it |
|---|---|
| Reading accounts or password hashes | `db.from('accounts').select()` |
| Linking your device to someone's account | `db.from('sessions').insert({ auth_uid: '<your-auth-id>', account_id: '<their-account-id>' })` |
| Signing in with a wrong password 11 times | `db.rpc('sign_in', { p_username: '<name>', p_password: 'wrong' })` should end with `'locked'` |
| Saving a result as someone else | `db.from('results').insert({ user_id: '<other-uuid>', game_id: 'wordle', play_date: '<today>', score: 1 })` |
| Saving a result for a far-off date | `db.rpc('save_results', { p_rows: [{ game_id: 'wordle', play_date: '2010-01-01', score: 1 }] })` |
| Marking your own result as not backfilled | `db.from('results').update({ backfilled: false }).eq('game_id', 'wordle')` |
| Changing someone else's result | `db.from('results').update({ score: 1 }).eq('user_id', '<other-uuid>')` |
| Reading someone else's list | `db.from('lists').select()` should return only your own |
| Reading someone else's friend code | `db.from('friend_codes').select()` should return only your own |
| Adding a friendship directly | `db.from('friendships').insert({ user_a: '<uuid>', user_b: '<uuid>' })` |
| Reading a private player's results | `db.from('results').select().eq('user_id', '<private-non-friend-uuid>')` should return no rows |
| Unbanning yourself | `db.from('profiles').update({ banned: false }).eq('user_id', '<your-account-id>')` |
| Reading the blocklist | `db.from('banned_words').select()` |
| Guessing friend codes | call `add_friend` an 11th time within a minute |

An update that's blocked by RLS can return no error and change zero rows, so read the row back to confirm nothing changed.

## How it behaves

**Without an account.** Everything works in the browser, and nothing is uploaded. Everyone boards can be read.

**Making an account or signing in.** Whatever is in the browser joins the account: all results, the game list and custom games. Signing in on a new device brings the account's history down. A change made on the device that hasn't been sent yet beats the server's copy.

**Syncing.** Changes go up within a second. Changes from other devices come down when the app opens and when you come back to its tab, at most every 20 seconds. Cleared results are kept on the server as tombstones (`deleted`), so other devices hear about them.

**Signing out** clears the browser, after checking nothing is still waiting to be sent.

**Old results and boards.** Any date from 2015 on can be saved, so history from before an account existed isn't lost. A result written more than a week after its day is marked `backfilled` and kept off that day's boards, so a past board can't be changed after the fact. It still counts for your own streaks.

**Friend codes.** A code is 10 hex characters, private to its owner. Using one makes the friendship straight away in both directions, since having the code is the consent. `rotate_friend_code` kills old links and keeps existing friends. There's a limit of 100 friends and 10 attempts a minute.

**Everyone boards.** Scores are self-reported and can't be verified, since the games are on other sites. To remove a cheater or a bad name, open **Table Editor → profiles** and set `banned` to `true`. That hides them from all boards and friend lists.

**Blocklist.** `banned_words` starts empty, so add your own words before launch:

```sql
insert into public.banned_words (word) values ('example');
```

A match anywhere inside a name rejects it, so very short words will also block innocent names.

**Rate limits**, per device per minute: 120 result writes (each up to 1000 rows), 30 list saves, 10 sign-in attempts, 5 sign-ups and 10 friend attempts.

## Updating the client library

`vendor/supabase.js` is a single pinned ESM build. To update it, download the new version's bundle, keep the header comment at the top, update the version there and in `CLAUDE.md`, and check that signing in and comparing still work against your development project.

## Changing the schema

Append a dated migration to the bottom of `schema.sql` so the database can always be rebuilt from this repo. Never weaken a policy just to make a feature work.
