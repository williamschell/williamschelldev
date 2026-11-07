-- Streakle database: tables, constraints, triggers, RLS policies and functions.
-- Run this whole file once in the Supabase SQL editor on an empty project. To change the
-- database later, append a dated migration at the bottom so it can always be rebuilt from here.
--
-- Security rules for this file:
--   * RLS is on for every table, and the browser only ever uses the anon key.
--   * Functions are security invoker wherever possible, so RLS still applies inside them.
--     The ones that must be security definer have an empty search_path, so every name in
--     them is fully qualified.
--   * Only numbers are stored for a result. Share text and grids stay on the device, so a
--     board can't spoil anyone's puzzle.

-- 2026-11-07: initial schema

-- ---------------------------------------------------------------------------
-- Display names
-- ---------------------------------------------------------------------------

-- A small blocklist of words not allowed in display names. Clients can't read it. Add to it
-- from the dashboard: insert into public.banned_words(word) values ('...');
create table public.banned_words (
  word text primary key check (word = lower(word))
);
alter table public.banned_words enable row level security;

create function public.is_valid_display_name(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select char_length(name) between 2 and 24
    and name ~ '^[[:alpha:][:digit:] _-]+$'
    and not exists (
      select 1 from public.banned_words b
      where position(b.word in lower(name)) > 0
    );
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (public.is_valid_display_name(display_name)),
  public_board boolean not null default true, -- appear on Everyone boards
  banned boolean not null default false,      -- set from the dashboard, hides this player
  created_at timestamptz not null default now()
);

-- Kept apart from profiles because profiles are public and codes must not be.
create table public.friend_codes (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  code text not null unique check (code ~ '^[0-9A-F]{10}$')
);

-- One row per pair, with the smaller id first, so a pair can't exist twice.
create table public.friendships (
  user_a uuid not null references public.profiles (user_id) on delete cascade,
  user_b uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b on public.friendships (user_b);

create table public.results (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  game_id text not null check (game_id ~ '^[a-z0-9-]{1,40}$'),
  play_date date not null,
  score int check (score between 0 and 1000000), -- null for games with no score
  failed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id, play_date)
);
create index results_board on public.results (game_id, play_date);

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

create table public.rate_events (
  user_id uuid not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup on public.rate_events (user_id, kind, created_at);
alter table public.rate_events enable row level security;

create function public.check_rate(what text, max_per_minute int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  recent int;
begin
  if uid is null then
    return;
  end if;
  delete from public.rate_events
    where user_id = uid and created_at < now() - interval '5 minutes';
  select count(*) into recent from public.rate_events
    where user_id = uid and kind = what and created_at > now() - interval '1 minute';
  if recent >= max_per_minute then
    raise exception 'Slow down a little' using errcode = 'P0429';
  end if;
  insert into public.rate_events (user_id, kind) values (uid, what);
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.make_friend_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 40 random bits. gen_random_uuid is cryptographically random, and add_friend is rate limited.
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

create function public.profiles_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.friend_codes (user_id, code) values (new.user_id, public.make_friend_code());
  return null;
end;
$$;

create trigger profiles_code after insert on public.profiles
  for each row execute function public.profiles_after_insert();

-- Runs per row, and joining can send a week of results at once, so the limit is generous.
create function public.results_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate('result', 300);
  new.updated_at := now();
  return new;
end;
$$;

create trigger results_write before insert or update on public.results
  for each row execute function public.results_before_write();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.friend_codes enable row level security;
alter table public.friendships enable row level security;
alter table public.results enable row level security;

create function public.is_friend(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.friendships f
    where f.user_a = least(auth.uid(), other) and f.user_b = greatest(auth.uid(), other)
  );
$$;

-- Definer so that the policies on results can read a player's flags without depending on
-- what the caller can see in profiles.
create function public.is_public_player(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = other and p.public_board and not p.banned
  );
$$;

-- Supabase grants broad table access to these roles by default, so start from nothing and
-- add back only what each table needs. RLS decides which rows, and these decide which columns.
revoke all on public.banned_words, public.rate_events, public.profiles, public.friend_codes,
  public.friendships, public.results
  from anon, authenticated;

grant select (user_id, display_name, public_board, banned, created_at) on public.profiles to anon, authenticated;
-- update includes user_id because an upsert writes every column it sends. The with check on
-- profiles_update still stops anyone changing it to another user's id.
grant insert (user_id, display_name, public_board),
      update (user_id, display_name, public_board),
      delete
  on public.profiles to authenticated;

grant select on public.friend_codes to authenticated;
grant select, delete on public.friendships to authenticated;

grant select on public.results to anon, authenticated;
grant insert (user_id, game_id, play_date, score, failed),
      update (user_id, game_id, play_date, score, failed),
      delete
  on public.results to authenticated;

-- profiles: banned players are hidden from everyone but themselves.
create policy profiles_read on public.profiles
  for select using (not banned or user_id = auth.uid());
create policy profiles_insert on public.profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_delete on public.profiles
  for delete to authenticated using (user_id = auth.uid());

-- friend_codes: only your own. Written only by definer functions.
create policy friend_codes_read on public.friend_codes
  for select to authenticated using (user_id = auth.uid());

-- friendships: only your own. Created only by add_friend, and either side can end one.
create policy friendships_read on public.friendships
  for select to authenticated using (auth.uid() in (user_a, user_b));
create policy friendships_delete on public.friendships
  for delete to authenticated using (auth.uid() in (user_a, user_b));

-- results: yours, your friends', and those of public players.
create policy results_read on public.results
  for select using (
    user_id = auth.uid() or public.is_friend(user_id) or public.is_public_player(user_id)
  );
-- Writing: your own row, for the past week up to a day ahead to allow for time zones.
create policy results_insert on public.results
  for insert to authenticated with check (
    user_id = auth.uid()
    and play_date between (now() at time zone 'utc')::date - 7 and (now() at time zone 'utc')::date + 1
  );
create policy results_update on public.results
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and play_date between (now() at time zone 'utc')::date - 7 and (now() at time zone 'utc')::date + 1
  );
create policy results_delete on public.results
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- API
-- ---------------------------------------------------------------------------

create function public.save_profile(p_name text, p_public boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.profiles (user_id, display_name, public_board)
  values (auth.uid(), p_name, p_public)
  on conflict (user_id) do update
    set display_name = excluded.display_name, public_board = excluded.public_board;
$$;

create function public.my_account()
returns table (display_name text, public_board boolean, friend_code text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.display_name, p.public_board, c.code
  from public.profiles p
  join public.friend_codes c on c.user_id = p.user_id
  where p.user_id = auth.uid();
$$;

create function public.rotate_friend_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fresh text := public.make_friend_code();
begin
  update public.friend_codes set code = fresh where user_id = auth.uid();
  if not found then
    raise exception 'No account' using errcode = 'P0401';
  end if;
  return fresh;
end;
$$;

create function public.add_friend(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  other uuid;
  other_name text;
begin
  if me is null or not exists (select 1 from public.profiles where user_id = me) then
    raise exception 'No account' using errcode = 'P0401';
  end if;
  -- Slow enough that guessing codes is hopeless, since 40 bits is about a trillion codes.
  perform public.check_rate('add-friend', 10);

  select c.user_id, p.display_name into other, other_name
  from public.friend_codes c
  join public.profiles p on p.user_id = c.user_id and not p.banned
  where c.code = upper(trim(p_code));

  -- This returns instead of raising because an exception would roll back the transaction,
  -- including the rate limit's record of this attempt, so wrong guesses would never count.
  if other is null then
    return null;
  end if;
  if other = me then
    raise exception 'That is your own code' using errcode = 'P0400';
  end if;
  if (
    select count(*) from public.friendships f where me in (f.user_a, f.user_b)
  ) >= 100 then
    raise exception 'Too many friends' using errcode = 'P0413';
  end if;

  insert into public.friendships (user_a, user_b)
  values (least(me, other), greatest(me, other))
  on conflict do nothing;
  return other_name;
end;
$$;

create function public.remove_friend(p_user uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.friendships
  where user_a = least(auth.uid(), p_user) and user_b = greatest(auth.uid(), p_user);
$$;

create function public.list_friends()
returns table (user_id uuid, display_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.user_id, p.display_name
  from public.friendships f
  join public.profiles p
    on p.user_id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where auth.uid() in (f.user_a, f.user_b)
  order by lower(p.display_name);
$$;

-- p_rows is an array of { game_id, play_date, score, failed }.
create function public.save_results(p_rows jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.results (user_id, game_id, play_date, score, failed)
  select auth.uid(), r.game_id, r.play_date, r.score, coalesce(r.failed, false)
  from jsonb_to_recordset(p_rows) as r (game_id text, play_date date, score int, failed boolean)
  on conflict (user_id, game_id, play_date) do update
    set score = excluded.score, failed = excluded.failed;
$$;

create function public.delete_result(p_game text, p_date date)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.results
  where user_id = auth.uid() and game_id = p_game and play_date = p_date;
$$;

-- One game's board for one day, with RLS deciding who can be seen. Failed results rank last.
-- Ties share a rank. scores.js rankRows follows the same rule, so change them together.
--
-- The streak counts back from p_date. Walking one person's dates newest first, date + row
-- number stays constant across consecutive days, so the run ending on p_date is exactly the
-- rows where it equals p_date + 1. Everyone on the board played on p_date, so that run exists.
create function public.game_board(p_game text, p_date date, p_scope text, p_lower boolean)
returns table (
  rank bigint, user_id uuid, display_name text, score int, failed boolean,
  is_me boolean, is_friend boolean, streak bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with visible as (
    select r.user_id, r.score, r.failed, p.display_name, public.is_friend(r.user_id) as friend
    from public.results r
    join public.profiles p on p.user_id = r.user_id
    where r.game_id = p_game
      and r.play_date = p_date
      and (
        p_scope = 'everyone'
        or r.user_id = auth.uid()
        or public.is_friend(r.user_id)
      )
  ),
  ranked as (
    select v.*, rank() over (
      order by v.failed,
        case when p_lower then v.score end asc nulls last,
        case when not p_lower then v.score end desc nulls last
    ) as rk
    from visible v
  )
  select
    k.rk, k.user_id, k.display_name, k.score, k.failed,
    k.user_id is not distinct from auth.uid(),
    k.friend,
    (
      select count(*) from (
        select s.play_date, row_number() over (order by s.play_date desc) as n
        from public.results s
        where s.user_id = k.user_id and s.game_id = p_game and s.play_date <= p_date
      ) d
      where d.play_date + d.n::int = p_date + 1
    )
  from ranked k
  -- The top 100, plus your own row wherever it falls.
  where k.rk <= 100 or k.user_id is not distinct from auth.uid()
  order by k.rk, lower(k.display_name)
  limit 101;
$$;

-- Your friends' results for one day across every game, for the Today view.
create function public.friends_day(p_date date)
returns table (game_id text, user_id uuid, display_name text, score int, failed boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.game_id, r.user_id, p.display_name, r.score, r.failed
  from public.results r
  join public.profiles p on p.user_id = r.user_id
  where r.play_date = p_date and public.is_friend(r.user_id);
$$;

-- Removes this player from the game. The profile delete cascades to results, friendships and
-- the friend code. The anonymous auth user is left behind, with nothing attached to it.
create function public.delete_my_data()
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.profiles where user_id = auth.uid();
$$;

-- Supabase lets every role call new functions by default, so start from nothing here too.
-- Triggers fire regardless of these grants.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Needed by policies and constraints, which run as the caller.
grant execute on function public.is_valid_display_name(text) to anon, authenticated;
grant execute on function public.is_friend(uuid) to anon, authenticated;
grant execute on function public.is_public_player(uuid) to anon, authenticated;

-- Everyone boards can be read without joining.
grant execute on function public.game_board(text, date, text, boolean) to anon, authenticated;

grant execute on function public.save_profile(text, boolean) to authenticated;
grant execute on function public.my_account() to authenticated;
grant execute on function public.rotate_friend_code() to authenticated;
grant execute on function public.add_friend(text) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.save_results(jsonb) to authenticated;
grant execute on function public.delete_result(text, date) to authenticated;
grant execute on function public.friends_day(date) to authenticated;
grant execute on function public.delete_my_data() to authenticated;


-- ===========================================================================
-- 2026-11-07: username and password accounts
-- ===========================================================================
--
-- Players are now accounts with a username and password, and an account holds everything:
-- the whole result history and the game list. Signing in on any device, or after clearing the
-- browser, brings it all back.
--
-- How it works: every browser still gets an anonymous Supabase session, which is only a device
-- id. Signing in links that session to an account in public.sessions, and public.me() turns
-- the session into the account. Everything that used auth.uid() as the player now uses me().
-- There's no email anywhere, so there's no password reset by email: an admin resets it (see
-- supabase/README.md).
--
-- Passwords are hashed with bcrypt by pgcrypto, and never leave the definer functions below.
-- Ten wrong passwords in 15 minutes locks a username for 15 minutes.
--
-- Results older than a week can now be saved, so history from before an account existed can be
-- uploaded. They're marked backfilled and kept off boards, so a past day's board can't be
-- changed after the fact. Cleared results are kept as tombstones (deleted = true) so other
-- devices hear about them.
--
-- THIS REMOVES PLAYERS MADE WITH THE OLD NO-SIGNUP SYSTEM, along with their shared scores and
-- friendships. Their history is still in their browsers and uploads again when they make an
-- account.

create extension if not exists pgcrypto with schema extensions;

delete from public.profiles;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  password_hash text not null,
  failed_logins int not null default 0,
  last_failed_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.accounts enable row level security;

-- Which account each device's session is signed in to.
create table public.sessions (
  auth_uid uuid primary key references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index sessions_account on public.sessions (account_id);
alter table public.sessions enable row level security;

-- Nobody reads or writes these directly. Only the definer functions below touch them.
revoke all on public.accounts, public.sessions from anon, authenticated;

-- The signed-in account, or null.
create function public.me()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.account_id from public.sessions s where s.auth_uid = auth.uid();
$$;

alter table public.profiles drop constraint profiles_user_id_fkey;
alter table public.profiles
  add constraint profiles_user_id_fkey foreign key (user_id) references public.accounts (id) on delete cascade;

alter table public.results
  add column backfilled boolean not null default false,
  add column deleted boolean not null default false;
create index results_mine on public.results (user_id, updated_at);

-- Each account's game list, in order, plus its custom games.
create table public.lists (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  games jsonb not null check (jsonb_typeof(games) = 'array' and jsonb_array_length(games) <= 200),
  custom_games jsonb not null check (
    jsonb_typeof(custom_games) = 'array'
    and jsonb_array_length(custom_games) <= 100
    and octet_length(custom_games::text) <= 40000
  ),
  updated_at timestamptz not null default now()
);
alter table public.lists enable row level security;

-- ---------------------------------------------------------------------------
-- Policies, rewritten around me()
-- ---------------------------------------------------------------------------

create or replace function public.is_friend(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.me() is not null and exists (
    select 1 from public.friendships f
    where f.user_a = least(public.me(), other) and f.user_b = greatest(public.me(), other)
  );
$$;

drop policy profiles_read on public.profiles;
drop policy profiles_insert on public.profiles;
drop policy profiles_update on public.profiles;
drop policy profiles_delete on public.profiles;
create policy profiles_read on public.profiles
  for select using (not banned or user_id = public.me());
create policy profiles_update on public.profiles
  for update to authenticated using (user_id = public.me()) with check (user_id = public.me());

drop policy friend_codes_read on public.friend_codes;
create policy friend_codes_read on public.friend_codes
  for select to authenticated using (user_id = public.me());

drop policy friendships_read on public.friendships;
drop policy friendships_delete on public.friendships;
create policy friendships_read on public.friendships
  for select to authenticated using (public.me() in (user_a, user_b));
create policy friendships_delete on public.friendships
  for delete to authenticated using (public.me() in (user_a, user_b));

drop policy results_read on public.results;
drop policy results_insert on public.results;
drop policy results_update on public.results;
drop policy results_delete on public.results;
create policy results_read on public.results
  for select using (
    user_id = public.me() or public.is_friend(user_id) or public.is_public_player(user_id)
  );
-- Any date from 2015 up to a day ahead, which allows for time zones.
create policy results_insert on public.results
  for insert to authenticated with check (
    user_id = public.me()
    and play_date between date '2015-01-01' and (now() at time zone 'utc')::date + 1
  );
create policy results_update on public.results
  for update to authenticated
  using (user_id = public.me())
  with check (
    user_id = public.me()
    and play_date between date '2015-01-01' and (now() at time zone 'utc')::date + 1
  );
create policy results_delete on public.results
  for delete to authenticated using (user_id = public.me());

create policy lists_own on public.lists
  for all to authenticated using (user_id = public.me()) with check (user_id = public.me());

-- Profiles are created by sign_up and removed with the account, so players only rename.
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name, public_board) on public.profiles to authenticated;

grant insert (deleted), update (deleted) on public.results to authenticated;

revoke all on public.lists from anon, authenticated;
grant select, insert (user_id, games, custom_games), update (games, custom_games) on public.lists to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- A result written more than a week after its day is backfilled, so it stays off boards.
-- Re-sending a result unchanged keeps what it was, and doesn't count as a change.
create or replace function public.results_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.score is not distinct from old.score
    and new.failed = old.failed
    and new.deleted = old.deleted then
    new.backfilled := old.backfilled;
    new.updated_at := old.updated_at;
  else
    new.backfilled := new.play_date < (now() at time zone 'utc')::date - 7;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

-- Rate limits per statement rather than per row, because signing in for the first time can
-- send years of history at once. Each statement is capped at 1000 rows.
create function public.results_after_statement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate('result', 120);
  if (select count(*) from changed) > 1000 then
    raise exception 'Too many results at once' using errcode = 'P0413';
  end if;
  return null;
end;
$$;

create trigger results_insert_batch after insert on public.results
  referencing new table as changed
  for each statement execute function public.results_after_statement();
create trigger results_update_batch after update on public.results
  referencing new table as changed
  for each statement execute function public.results_after_statement();

create function public.lists_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate('list', 30);
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger lists_write before insert or update on public.lists
  for each row execute function public.lists_before_write();

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

-- Usernames are lowercase. The username is also the starting display name, so the display
-- name rules and blocklist apply to it too, through the profiles check.
create function public.sign_up(p_username text, p_password text, p_public boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean text := lower(trim(p_username));
  new_id uuid;
begin
  if uid is null then
    raise exception 'No session' using errcode = 'P0401';
  end if;
  perform public.check_rate('sign-up', 5);
  if clean !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Bad username' using errcode = 'P0422';
  end if;
  if p_password is null or char_length(p_password) < 8 or octet_length(p_password) > 72 then
    raise exception 'Bad password' using errcode = 'P0423';
  end if;
  if exists (select 1 from public.accounts a where a.username = clean) then
    raise exception 'Username taken' using errcode = 'P0409';
  end if;

  insert into public.accounts (username, password_hash)
  values (clean, extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
  returning id into new_id;
  insert into public.profiles (user_id, display_name, public_board)
  values (new_id, clean, coalesce(p_public, true));
  insert into public.sessions (auth_uid, account_id) values (uid, new_id)
  on conflict (auth_uid) do update set account_id = excluded.account_id, created_at = now();
end;
$$;

-- Returns 'ok', 'bad' or 'locked' instead of raising, because an exception would roll back
-- the record of a wrong password, and then guessing would never lock anything.
create function public.sign_in(p_username text, p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  found_id uuid;
  stored text;
  locked timestamptz;
  recent_failures int;
begin
  if uid is null then
    raise exception 'No session' using errcode = 'P0401';
  end if;
  perform public.check_rate('sign-in', 10);

  select a.id, a.password_hash, a.locked_until,
    case when a.last_failed_at > now() - interval '15 minutes' then a.failed_logins else 0 end
  into found_id, stored, locked, recent_failures
  from public.accounts a
  where a.username = lower(trim(coalesce(p_username, '')))
  for update;

  if found_id is null then
    return 'bad';
  end if;
  if locked is not null and locked > now() then
    return 'locked';
  end if;
  if p_password is null or stored <> extensions.crypt(p_password, stored) then
    update public.accounts set
      failed_logins = recent_failures + 1,
      last_failed_at = now(),
      locked_until = case when recent_failures + 1 >= 10 then now() + interval '15 minutes' end
    where id = found_id;
    return 'bad';
  end if;

  update public.accounts set failed_logins = 0, locked_until = null where id = found_id;
  insert into public.sessions (auth_uid, account_id) values (uid, found_id)
  on conflict (auth_uid) do update set account_id = excluded.account_id, created_at = now();
  return 'ok';
end;
$$;

create function public.sign_out()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.sessions where auth_uid = auth.uid();
$$;

-- Signs out every other device, so a changed password locks out anyone who knew the old one.
create function public.change_password(p_old text, p_new text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  mine uuid := public.me();
  stored text;
begin
  if mine is null then
    raise exception 'No account' using errcode = 'P0401';
  end if;
  perform public.check_rate('sign-in', 10);
  if p_new is null or char_length(p_new) < 8 or octet_length(p_new) > 72 then
    raise exception 'Bad password' using errcode = 'P0423';
  end if;
  select a.password_hash into stored from public.accounts a where a.id = mine;
  if p_old is null or stored <> extensions.crypt(p_old, stored) then
    return false;
  end if;
  update public.accounts
    set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10))
    where id = mine;
  delete from public.sessions where account_id = mine and auth_uid <> auth.uid();
  return true;
end;
$$;

-- Everything goes: the account cascades to sessions, the profile, results, friendships, the
-- friend code and the list.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.me() is null then
    raise exception 'No account' using errcode = 'P0401';
  end if;
  delete from public.accounts where id = public.me();
end;
$$;

drop function public.delete_my_data();

-- ---------------------------------------------------------------------------
-- API, rewritten around me()
-- ---------------------------------------------------------------------------

create or replace function public.save_profile(p_name text, p_public boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.profiles set display_name = p_name, public_board = p_public
  where user_id = public.me();
$$;

drop function public.my_account();
create function public.my_account()
returns table (username text, display_name text, public_board boolean, friend_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.username, p.display_name, p.public_board, c.code
  from public.accounts a
  join public.profiles p on p.user_id = a.id
  join public.friend_codes c on c.user_id = a.id
  where a.id = public.me();
$$;

create or replace function public.rotate_friend_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fresh text := public.make_friend_code();
begin
  update public.friend_codes set code = fresh where user_id = public.me();
  if not found then
    raise exception 'No account' using errcode = 'P0401';
  end if;
  return fresh;
end;
$$;

create or replace function public.add_friend(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  mine uuid := public.me();
  other uuid;
  other_name text;
begin
  if mine is null or not exists (select 1 from public.profiles where user_id = mine) then
    raise exception 'No account' using errcode = 'P0401';
  end if;
  -- Slow enough that guessing codes is hopeless, since 40 bits is about a trillion codes.
  perform public.check_rate('add-friend', 10);

  select c.user_id, p.display_name into other, other_name
  from public.friend_codes c
  join public.profiles p on p.user_id = c.user_id and not p.banned
  where c.code = upper(trim(p_code));

  -- This returns instead of raising because an exception would roll back the transaction,
  -- including the rate limit's record of this attempt, so wrong guesses would never count.
  if other is null then
    return null;
  end if;
  if other = mine then
    raise exception 'That is your own code' using errcode = 'P0400';
  end if;
  if (
    select count(*) from public.friendships f where mine in (f.user_a, f.user_b)
  ) >= 100 then
    raise exception 'Too many friends' using errcode = 'P0413';
  end if;

  insert into public.friendships (user_a, user_b)
  values (least(mine, other), greatest(mine, other))
  on conflict do nothing;
  return other_name;
end;
$$;

create or replace function public.remove_friend(p_user uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.friendships
  where user_a = least(public.me(), p_user) and user_b = greatest(public.me(), p_user);
$$;

create or replace function public.list_friends()
returns table (user_id uuid, display_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.user_id, p.display_name
  from public.friendships f
  join public.profiles p
    on p.user_id = case when f.user_a = public.me() then f.user_b else f.user_a end
  where public.me() in (f.user_a, f.user_b)
  order by lower(p.display_name);
$$;

-- p_rows is an array of { game_id, play_date, score, failed, deleted }. A deleted row is a
-- tombstone, so its score is dropped.
create or replace function public.save_results(p_rows jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.results (user_id, game_id, play_date, score, failed, deleted)
  select public.me(), r.game_id, r.play_date,
    case when coalesce(r.deleted, false) then null else r.score end,
    coalesce(r.failed, false) and not coalesce(r.deleted, false),
    coalesce(r.deleted, false)
  from jsonb_to_recordset(p_rows) as r (game_id text, play_date date, score int, failed boolean, deleted boolean)
  on conflict (user_id, game_id, play_date) do update
    set score = excluded.score, failed = excluded.failed, deleted = excluded.deleted;
$$;

create or replace function public.delete_result(p_game text, p_date date)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.results set score = null, failed = false, deleted = true
  where user_id = public.me() and game_id = p_game and play_date = p_date;
$$;

-- Your own results changed since p_since, tombstones included, oldest change first. The two
-- minutes of overlap catch writes that committed out of order. Fetching a row twice is harmless.
create function public.my_results(p_since timestamptz)
returns table (game_id text, play_date date, score int, failed boolean, deleted boolean, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.game_id, r.play_date, r.score, r.failed, r.deleted, r.updated_at
  from public.results r
  where r.user_id = public.me()
    and (p_since is null or r.updated_at > p_since - interval '2 minutes')
  order by r.updated_at
  limit 10000;
$$;

-- Returns the list's new version, so this device knows it's up to date.
create function public.save_list(p_games jsonb, p_custom jsonb)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  insert into public.lists (user_id, games, custom_games)
  values (public.me(), p_games, p_custom)
  on conflict (user_id) do update
    set games = excluded.games, custom_games = excluded.custom_games
  returning updated_at;
$$;

create function public.my_list()
returns table (games jsonb, custom_games jsonb, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.games, l.custom_games, l.updated_at from public.lists l where l.user_id = public.me();
$$;

create or replace function public.game_board(p_game text, p_date date, p_scope text, p_lower boolean)
returns table (
  rank bigint, user_id uuid, display_name text, score int, failed boolean,
  is_me boolean, is_friend boolean, streak bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with visible as (
    select r.user_id, r.score, r.failed, p.display_name, public.is_friend(r.user_id) as friend
    from public.results r
    join public.profiles p on p.user_id = r.user_id
    where r.game_id = p_game
      and r.play_date = p_date
      and not r.deleted
      and not r.backfilled
      and (
        p_scope = 'everyone'
        or r.user_id = public.me()
        or public.is_friend(r.user_id)
      )
  ),
  ranked as (
    select v.*, rank() over (
      order by v.failed,
        case when p_lower then v.score end asc nulls last,
        case when not p_lower then v.score end desc nulls last
    ) as rk
    from visible v
  )
  select
    k.rk, k.user_id, k.display_name, k.score, k.failed,
    k.user_id is not distinct from public.me(),
    k.friend,
    (
      select count(*) from (
        select s.play_date, row_number() over (order by s.play_date desc) as n
        from public.results s
        where s.user_id = k.user_id and s.game_id = p_game and s.play_date <= p_date and not s.deleted
      ) d
      where d.play_date + d.n::int = p_date + 1
    )
  from ranked k
  -- The top 100, plus your own row wherever it falls.
  where k.rk <= 100 or k.user_id is not distinct from public.me()
  order by k.rk, lower(k.display_name)
  limit 101;
$$;

create or replace function public.friends_day(p_date date)
returns table (game_id text, user_id uuid, display_name text, score int, failed boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.game_id, r.user_id, p.display_name, r.score, r.failed
  from public.results r
  join public.profiles p on p.user_id = r.user_id
  where r.play_date = p_date and not r.deleted and not r.backfilled and public.is_friend(r.user_id);
$$;

-- New functions can be called by everyone by default, so close them and open what's needed.
revoke execute on function
  public.me(), public.results_after_statement(), public.lists_before_write(),
  public.sign_up(text, text, boolean), public.sign_in(text, text), public.sign_out(),
  public.change_password(text, text), public.delete_my_account(), public.my_account(),
  public.my_results(timestamptz), public.save_list(jsonb, jsonb), public.my_list()
  from public, anon, authenticated;

-- Needed by policies, which run as the caller.
grant execute on function public.me() to anon, authenticated;

-- Anonymous Supabase users are "authenticated", so these work from a device that hasn't
-- signed in yet. Each one checks for itself whether there's an account.
grant execute on function public.sign_up(text, text, boolean) to authenticated;
grant execute on function public.sign_in(text, text) to authenticated;
grant execute on function public.sign_out() to authenticated;
grant execute on function public.change_password(text, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.my_account() to authenticated;
grant execute on function public.my_results(timestamptz) to authenticated;
grant execute on function public.save_list(jsonb, jsonb) to authenticated;
grant execute on function public.my_list() to authenticated;
