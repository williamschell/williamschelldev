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
