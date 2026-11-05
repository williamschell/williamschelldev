-- Splotchio database: tables, constraints, triggers, RLS policies and storage rules.
-- Run this whole file once in the Supabase SQL editor on an empty project. To change the
-- database later, append a dated migration at the bottom so it can always be rebuilt from here.
--
-- Security rules for this file:
--   * RLS is on for every table, and the browser only ever uses the anon key.
--   * Counters and moderation flags can only be changed by triggers. Column-level grants
--     stop clients from writing them, even on their own rows.
--   * Trigger functions are SECURITY DEFINER with an empty search_path, so every name in
--     them is fully qualified.

-- 2026-11-04: initial schema

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

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (public.is_valid_display_name(display_name)),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Posts, likes and reports
-- ---------------------------------------------------------------------------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  daily_date date not null,
  gen_version int not null check (gen_version > 0),
  transform jsonb not null check (jsonb_typeof(transform) = 'object' and pg_column_size(transform) < 1024),
  blob_style jsonb not null check (jsonb_typeof(blob_style) = 'object' and pg_column_size(blob_style) < 1024),
  image_path text not null check (char_length(image_path) < 256),
  thumb_path text not null check (char_length(thumb_path) < 256),
  like_count int not null default 0,
  report_count int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, daily_date),
  -- Lets the API embed the poster's name. A profile has to exist before posting.
  constraint posts_profile_fk foreign key (user_id) references public.profiles (user_id) on delete cascade
);

create index posts_daily_new on public.posts (daily_date, created_at desc, id desc);
create index posts_daily_top on public.posts (daily_date, like_count desc, created_at, id);
create index posts_all_top on public.posts (like_count desc, created_at, id);

create table public.likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index likes_user on public.likes (user_id);

create table public.reports (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

-- A log of recent actions, so like/unlike spam counts even though unliking deletes the row.
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
-- Triggers. These are the only things that write like_count, report_count and hidden.
-- ---------------------------------------------------------------------------

create function public.likes_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate('like', 60);
  return new;
end;
$$;

create trigger likes_rate before insert on public.likes
  for each row execute function public.likes_before_insert();

create function public.likes_count_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  else
    -- Runs during a cascading post delete too, where it simply matches no row.
    update public.posts set like_count = greatest(0, like_count - 1) where id = old.post_id;
  end if;
  return null;
end;
$$;

create trigger likes_count after insert or delete on public.likes
  for each row execute function public.likes_count_changed();

create function public.reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate('report', 10);
  return new;
end;
$$;

create trigger reports_rate before insert on public.reports
  for each row execute function public.reports_before_insert();

create function public.reports_count_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
    set report_count = report_count + 1,
        hidden = hidden or report_count + 1 >= 3
    where id = new.post_id;
  return null;
end;
$$;

create trigger reports_count after insert on public.reports
  for each row execute function public.reports_count_changed();

-- Triggers fire regardless of these grants. This only stops the functions being called
-- directly through the API. is_valid_display_name stays callable by the roles that write
-- profiles, since its check constraint runs as them.
revoke execute on function public.check_rate(text, int) from public, anon, authenticated;
revoke execute on function public.likes_before_insert() from public, anon, authenticated;
revoke execute on function public.likes_count_changed() from public, anon, authenticated;
revoke execute on function public.reports_before_insert() from public, anon, authenticated;
revoke execute on function public.reports_count_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.reports enable row level security;

-- Supabase grants broad table access to these roles by default, so start from nothing and
-- add back only what each table needs. RLS decides which rows, and these decide which columns.
revoke all on public.banned_words, public.rate_events, public.profiles, public.posts, public.likes, public.reports
  from anon, authenticated;

grant select on public.profiles to anon, authenticated;
-- update includes user_id because an upsert writes every column it sends. The with check on
-- profiles_update still stops anyone changing it to another user's id.
grant insert (user_id, display_name), update (user_id, display_name) on public.profiles to authenticated;

grant select on public.posts to anon, authenticated;
grant insert (user_id, daily_date, gen_version, transform, blob_style, image_path, thumb_path)
  on public.posts to authenticated;
grant delete on public.posts to authenticated;

grant select on public.likes to anon, authenticated;
grant insert (post_id, user_id), delete on public.likes to authenticated;

grant insert (post_id, user_id, reason) on public.reports to authenticated;

-- profiles: anyone can read names, and you can only write your own.
create policy profiles_read on public.profiles
  for select using (true);
create policy profiles_insert on public.profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- posts: hidden ones are only visible to their owner.
create policy posts_read on public.posts
  for select using (hidden = false or user_id = auth.uid());

-- Posting: your own row, within a day either side of the server's UTC date to allow for time
-- zones, and with image paths inside your own folder for that date.
create policy posts_insert on public.posts
  for insert to authenticated with check (
    user_id = auth.uid()
    and daily_date between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1
    and image_path like auth.uid()::text || '/' || daily_date::text || '/%'
    and thumb_path like auth.uid()::text || '/' || daily_date::text || '/%'
  );

create policy posts_delete on public.posts
  for delete to authenticated using (user_id = auth.uid());

-- No update policy on posts, deliberately: posts can't be edited, only deleted and re-posted.

-- likes: public to read. You can only add or remove your own, and only on someone else's
-- post that you're allowed to see.
create policy likes_read on public.likes
  for select using (true);
create policy likes_insert on public.likes
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.user_id <> auth.uid())
  );
create policy likes_delete on public.likes
  for delete to authenticated using (user_id = auth.uid());

-- reports: write-only for clients. No select policy, so nobody can read them through the API.
-- The owner check is here so you can't hide your own post and then see that it was reported.
create policy reports_insert on public.reports
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.user_id <> auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posts', 'posts', true, 409600, array['image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files live at {user_id}/{daily_date}/{uuid}.webp inside the posts bucket. Uploads are limited
-- to your own folder and to a date in the same window as posting. The public bucket serves
-- downloads by URL without any policy, so select is only for your own folder, which removing
-- a file needs. That also means nobody can list the bucket to find hidden posts' images.
create policy posts_files_read on storage.objects
  for select to authenticated using (
    bucket_id = 'posts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy posts_files_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'posts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] in (
      ((now() at time zone 'utc')::date - 1)::text,
      ((now() at time zone 'utc')::date)::text,
      ((now() at time zone 'utc')::date + 1)::text
    )
  );

create policy posts_files_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'posts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
