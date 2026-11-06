# Setting up the Splotchle gallery on Supabase

The app works without any of this. Until `js/config.js` is filled in, the Today, All-Time and Unlimiteds tabs show a friendly offline state, and drawing, saving and streaks work as normal.

Make two projects, one for production and one for development, and repeat these steps for each. Testing should never touch production data.

## Steps

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**.
3. Open the **SQL editor**, paste in all of [schema.sql](schema.sql), and run it.
4. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into [../js/config.js](../js/config.js). Production values go in `PRODUCTION` and development values in `DEVELOPMENT`. The app uses `DEVELOPMENT` on `localhost` and `127.0.0.1`, and `PRODUCTION` everywhere else.

Never copy the `service_role` key anywhere in this repo. It bypasses all of the security rules.

## Check the security rules

Run these from the browser console on your **development** project, after the page has signed in by liking or posting once. Every one of them must fail. To get a client:

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
| Posting without a date or a blob | `insert` into `posts` with `daily_date: null` and no `seed` or `params` |
| Mixing the two kinds of post | `insert` into `posts` with both a `daily_date` and a `seed` |
| Flooding Unlimiteds | `insert` a 21st unlimited post within a day |
| Faking your like count on insert | `insert` into `posts` with `like_count: 999` |
| Editing a counter | `db.from('posts').update({ like_count: 999 }).eq('id', id)` |
| Unhiding a post | `db.from('posts').update({ hidden: false }).eq('id', id)` |
| Reading reports | `db.from('reports').select()` should return an error or no rows |
| Reading the blocklist | `db.from('banned_words').select()` should return an error or no rows |
| Uploading to someone else's folder | `db.storage.from('posts').upload('<other-uuid>/2026-11-04/x.webp', file)` |
| Uploading the wrong type | upload a `text/plain` file to your own folder |

An update that's blocked by RLS can return no error and change zero rows, so read the row back to confirm nothing changed.

## How it behaves

**One post per day, and re-posting means deleting first.** There's a unique constraint on `(user_id, daily_date)`. Replacing an image while keeping its likes would let someone collect likes on one drawing and then swap in another, so deleting a post also deletes its likes.

**Unlimiteds.** A free play post has `daily_date` set to null and stores the `seed` and `params` that rebuild its blob, so it never appears in Today or All-Time. Each user can have 20 from the past day and post 5 a minute, set in `posts_before_insert`. Only posts that still exist count toward the 20. Likes, reports and hiding work the same as for daily posts.

**Reports.** Three reports set `hidden = true`. To review hidden posts, open **Table Editor → posts** and filter on `hidden = true`. Set `hidden` back to `false` and `report_count` to `0` to restore a post, or delete the row to remove it. Deleting a row in the dashboard leaves its image files behind, so remove the post's folder from **Storage → posts** too.

**Blocklist.** `banned_words` starts empty, so add your own words before launch:

```sql
insert into public.banned_words (word) values ('example');
```

A match anywhere inside a name rejects it, so very short words will also block innocent names.

**Rate limits.** Each user gets 60 likes and 10 reports per minute, enforced by triggers. Anonymous sign-ins are the weak point, since a new account costs nothing and three reports hide a post. If that gets abused, turn on Supabase's auth rate limits and CAPTCHA for anonymous sign-ins, or raise the report threshold in `reports_count_changed`.

**Orphaned files.** An upload that's never followed by a post leaves files in storage. The client cleans up after a failed insert, but a modified client could skip that. Each file is capped at 400 KB and limited to your own folder and a current date.

## Updating the client library

`vendor/supabase.js` is a single pinned ESM build. To update it, download the new version's bundle, keep the header comment at the top, update the version there and in `CLAUDE.md` §10, and check that the gallery still works against your development project.

## Changing the schema

Append a dated migration to the bottom of `schema.sql` so the database can always be rebuilt from this repo. Never weaken a policy just to make a feature work.
