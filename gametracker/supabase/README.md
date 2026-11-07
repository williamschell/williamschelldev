# Setting up Streakle on Supabase

The app works without any of this. Until `js/config.js` is filled in, your list, logging and streaks work as normal, and the Compare and Friends tabs say comparing isn't set up.

Streakle gets its own project, separate from Splotchle's and Novle's. Make one for production, and ideally a second for development, and repeat these steps for each.

## Steps

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**.
3. Open the **SQL editor**, paste in all of [schema.sql](schema.sql), and run it.
4. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into [../js/config.js](../js/config.js). Production values go in `PRODUCTION` and development values in `DEVELOPMENT`. The app uses `DEVELOPMENT` on `localhost` and `127.0.0.1`, and `PRODUCTION` everywhere else.

Never copy the `service_role` key anywhere in this repo. It bypasses all of the security rules.

## Check the security rules

`tests/e2e.mjs` checks these against the real schema in PGlite, but not on Supabase itself, so run them once on your **development** project from the browser console. Every one of them must fail or change nothing. To get a client:

```js
const { createClient } = await import('./vendor/supabase.js');
const { SUPABASE } = await import('./js/config.js');
const db = createClient(SUPABASE.url, SUPABASE.anonKey);
const { data: { user } } = await db.auth.signInAnonymously();
```

| Try this | How to run it |
|---|---|
| Saving a result as someone else | `db.from('results').insert({ user_id: '<other-uuid>', game_id: 'wordle', play_date: '<today>', score: 1 })` |
| Saving a result for a far-off date | `db.rpc('save_results', { p_rows: [{ game_id: 'wordle', play_date: '2020-01-01', score: 1 }] })` |
| Changing someone else's result | `db.from('results').update({ score: 1 }).eq('user_id', '<other-uuid>')` |
| Reading someone else's friend code | `db.from('friend_codes').select()` should return only your own |
| Adding a friendship directly | `db.from('friendships').insert({ user_a: '<uuid>', user_b: '<uuid>' })` |
| Reading a private player's results | `db.from('results').select().eq('user_id', '<private-non-friend-uuid>')` should return no rows |
| Unbanning yourself | `db.from('profiles').update({ banned: false }).eq('user_id', user.id)` |
| Reading the blocklist | `db.from('banned_words').select()` |
| Guessing friend codes | call `add_friend` an 11th time within a minute |

An update that's blocked by RLS can return no error and change zero rows, so read the row back to confirm nothing changed.

## How it behaves

**Joining.** Nobody signs in or uploads anything until they press Start comparing. Everyone boards can be read without joining.

**Identity.** Each browser gets an anonymous user, so a phone and a laptop are two players. Clearing site data loses the account, though not a backup file.

**Friend codes.** A code is 10 hex characters, private to its owner. Using one makes the friendship straight away in both directions, since having the code is the consent. `rotate_friend_code` kills old links and keeps existing friends. There's a limit of 100 friends and 10 attempts a minute.

**Everyone boards.** Scores are self-reported and can't be verified, since the games are on other sites. To remove a cheater or a bad name, open **Table Editor → profiles** and set `banned` to `true`. That hides them from all boards and friend lists.

**Blocklist.** `banned_words` starts empty, so add your own words before launch:

```sql
insert into public.banned_words (word) values ('example');
```

A match anywhere inside a name rejects it, so very short words will also block innocent names.

**Rate limits.** 300 result writes and 10 friend attempts per user per minute, enforced in the database. New anonymous accounts cost nothing, so if that gets abused, turn on Supabase's auth rate limits and CAPTCHA for anonymous sign-ins.

**Leaving.** `delete_my_data` removes the profile, which cascades to results, friendships and the friend code. The anonymous auth user is left behind with nothing attached, and can be cleared from **Authentication → Users**.

## Updating the client library

`vendor/supabase.js` is a single pinned ESM build. To update it, download the new version's bundle, keep the header comment at the top, update the version there and in `CLAUDE.md`, and check that comparing still works against your development project.

## Changing the schema

Append a dated migration to the bottom of `schema.sql` so the database can always be rebuilt from this repo. Never weaken a policy just to make a feature work.
