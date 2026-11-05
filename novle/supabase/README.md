# Setting up the Novle gallery on Supabase

The app works without any of this. Until `js/config.js` is filled in, the Today and All-Time tabs show a friendly offline state, and writing, saving and streaks work as normal.

Novle needs **its own project**, separate from Splotchio. Both use tables called `posts`, `likes` and so on, and sharing a project would break Splotchio's gallery. Supabase's free plan allows two active projects, so a production project for each game fits, but a separate development project may need a paid plan or local `supabase start`.

## Steps

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**.
3. Open the **SQL editor**, paste in all of [schema.sql](schema.sql), and run it.
4. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into [../js/config.js](../js/config.js). Production values go in `PRODUCTION` and development values in `DEVELOPMENT`. The app uses `DEVELOPMENT` on `localhost` and `127.0.0.1`, and `PRODUCTION` everywhere else.

Never copy the `service_role` key anywhere in this repo. It bypasses all of the security rules.

## Check the security rules

Run these from the browser console on a **development** project. Every one of them must fail. To get a client:

```js
const { createClient } = await import('./vendor/supabase.js');
const { SUPABASE } = await import('./js/config.js');
const db = createClient(SUPABASE.url, SUPABASE.anonKey);
const { data: { user } } = await db.auth.signInAnonymously();
```

| Try this | How to run it |
|---|---|
| Liking twice | `insert` the same row into `likes` twice |
| Liking your own post | `insert` into `likes` with your own post's id |
| Posting as someone else | `insert` into `posts` with another `user_id` |
| Posting for a far-off date | `insert` into `posts` with `daily_date: '2020-01-01'` |
| Posting twice in a day | `insert` two posts with the same `daily_date` |
| Going over the limit | `insert` a `body` with more words than its `word_limit` |
| Faking the limit | `insert` with `word_limit: 999999` |
| Faking the word count | `insert` with `word_count: 5` |
| Faking your like count | `insert` into `posts` with `like_count: 999` |
| Editing a story | `db.from('posts').update({ body: 'new text' }).eq('id', id)` |
| Editing a counter | `db.from('posts').update({ like_count: 999 }).eq('id', id)` |
| Unhiding a post | `db.from('posts').update({ hidden: false }).eq('id', id)` |
| Reading reports | `db.from('reports').select()` should return an error or no rows |
| Reading the blocklist | `db.from('banned_words').select()` should return an error or no rows |

An update that's blocked by RLS can return no error and change zero rows, so read the row back to confirm nothing changed.

## How it behaves

**One post per day, and re-posting means deleting first.** There's a unique constraint on `(user_id, daily_date)`. Editing a story while keeping its likes would let someone collect likes on one story and then swap in another, so deleting a post also deletes its likes.

**Word limits.** The database counts the words itself and rejects stories outside 10 words to `word_limit`. It can't know the real limit for the day, since prompts come from the client, so it only caps `word_limit` at 5,000. See `CLAUDE.md` §4.

**Reports.** Three reports set `hidden = true`. To review hidden posts, open **Table Editor → posts** and filter on `hidden = true`. Set `hidden` back to `false` and `report_count` to `0` to restore a post, or delete the row to remove it.

**Blocklist.** `banned_words` starts empty, so add your own words before launch. It only applies to display names, not story text:

```sql
insert into public.banned_words (word) values ('example');
```

A match anywhere inside a name rejects it, so very short words will also block innocent names.

**Rate limits.** Each user gets 10 posts, 60 likes and 10 reports per minute, enforced by triggers. Anonymous sign-ins are the weak point, since a new account costs nothing and three reports hide a post. If that gets abused, turn on Supabase's auth rate limits and CAPTCHA for anonymous sign-ins, or raise the report threshold in `reports_count_changed`.

## Changing the schema

Append a dated migration to the bottom of `schema.sql` so the database can always be rebuilt from this repo. Never weaken a policy just to make a feature work.
