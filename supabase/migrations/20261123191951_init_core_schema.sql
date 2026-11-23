-- =============================================================================
-- Daily Fitted: core schema
--
-- Covers: profiles, friendships, blocks, outfits, the detection job queue, and
-- the private photo bucket. Items, products, and ranking comparisons come in
-- later migrations (Phases 3-4).
--
-- Privacy model: every table has Row Level Security (RLS) turned on. RLS makes
-- Postgres itself check "may this signed-in user see/change this row?", so a
-- bug in the app or the API cannot leak another person's photos.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Profiles: one row per signed-in user (Supabase keeps the login itself in
-- auth.users; this table holds the app-facing fields).
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  username         text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name     text check (char_length(display_name) <= 50),
  avatar_path      text,
  -- Private by default (product rule). Today every profile is friends-only;
  -- this flag is kept so "public profile" can be added later without a migration.
  is_private       boolean not null default true,
  -- Users must be 18+ (product rule). Set when the account is created.
  age_confirmed_at timestamptz not null,
  created_at       timestamptz not null default now()
);

-- Create the profile automatically when someone signs up. The app sends
-- { age_confirmed: true } as sign-up metadata after the user ticks "I'm 18+";
-- the database refuses the sign-up without it.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((new.raw_user_meta_data ->> 'age_confirmed')::boolean, false) is not true then
    raise exception 'Daily Fitted is for people 18 and older'
      using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, age_confirmed_at) values (new.id, now());
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- -----------------------------------------------------------------------------
-- Friendships (mutual: one side requests, the other accepts) and blocks.
-- -----------------------------------------------------------------------------
create type public.friendship_status as enum ('pending', 'accepted');

create table public.friendships (
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       public.friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

-- Only one friendship row per pair, whichever direction it was requested in.
create unique index friendships_one_per_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index friendships_addressee on public.friendships (addressee_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);


-- -----------------------------------------------------------------------------
-- Visibility helpers.
--
-- These are SECURITY DEFINER: they run with the table owner's rights so they
-- can read friendships/blocks without tripping those tables' own RLS (which
-- would otherwise recurse). can_view_user only ever answers about the CURRENT
-- user, so nobody can use it to probe other people's friendships.
-- -----------------------------------------------------------------------------
create function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = a and f.addressee_id = b)
          or (f.requester_id = b and f.addressee_id = a))
    )
    and not exists (
      select 1 from public.blocks bl
      where (bl.blocker_id = a and bl.blocked_id = b)
         or (bl.blocker_id = b and bl.blocked_id = a)
    );
$$;

-- Internal only: not callable directly by app users.
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- "Can the signed-in user see this person's outfits?" Yes if it's themselves
-- or an accepted, unblocked friend.
create function public.can_view_user(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select owner = auth.uid() or public.are_friends(auth.uid(), owner);
$$;

revoke execute on function public.can_view_user(uuid) from public, anon;
grant execute on function public.can_view_user(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- Outfits: one photo per post.
-- -----------------------------------------------------------------------------
create table public.outfits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- Path inside the private "outfit-photos" bucket, e.g. "<user_id>/<uuid>.jpg".
  -- We store the path, not a URL: private photos are shown with short-lived
  -- signed URLs, never a permanent public link.
  photo_path  text not null unique,
  caption     text check (char_length(caption) <= 280),
  -- The user's local date, sent by the app (the server's "today" is UTC).
  worn_on     date not null default current_date,
  -- Fractional rank: higher = better. Inserting between two outfits uses the
  -- midpoint of their keys, so only the new row is written. NULL = not ranked yet.
  rank_key    numeric,
  created_at  timestamptz not null default now(),
  -- A user can only attach photos from their own folder.
  constraint outfits_photo_in_own_folder check (photo_path like user_id::text || '/%')
);

create index outfits_by_user_date on public.outfits (user_id, worn_on desc, created_at desc);
create index outfits_by_user_rank on public.outfits (user_id, rank_key desc);


-- -----------------------------------------------------------------------------
-- Detection job queue.
--
-- A plain Postgres table used as a queue. Workers claim jobs with
-- SELECT ... FOR UPDATE SKIP LOCKED, so several workers can run at once and
-- each job is taken by exactly one of them. No extra infrastructure needed.
-- -----------------------------------------------------------------------------
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed');

create table public.detection_jobs (
  id           bigint generated always as identity primary key,
  outfit_id    uuid not null references public.outfits (id) on delete cascade,
  status       public.job_status not null default 'queued',
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Small index containing only jobs that are waiting to run.
create index detection_jobs_ready on public.detection_jobs (run_after) where status = 'queued';
create index detection_jobs_running on public.detection_jobs (locked_at) where status = 'running';

-- Every new outfit gets a detection job, however it was inserted. Posting
-- never waits for detection (product rule): this only adds a queue row.
create function public.enqueue_detection_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.detection_jobs (outfit_id) values (new.id);
  return new;
end;
$$;

create trigger on_outfit_created
  after insert on public.outfits
  for each row execute function public.enqueue_detection_job();


-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.friendships    enable row level security;
alter table public.blocks         enable row level security;
alter table public.outfits        enable row level security;
alter table public.detection_jobs enable row level security;

-- Signed-out visitors (the "anon" role) get nothing.
revoke all on public.profiles, public.friendships, public.blocks,
              public.outfits, public.detection_jobs from anon;

-- The job queue is for the worker only (it connects with a privileged role
-- that bypasses RLS). App users cannot read or write it at all.
revoke all on public.detection_jobs from authenticated;

-- profiles ---------------------------------------------------------------------
create policy "profiles: see yourself and friends"
  on public.profiles for select to authenticated
  using (public.can_view_user(id));

-- Users may edit only these columns of their own row (not age_confirmed_at).
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_path, is_private) on public.profiles to authenticated;

create policy "profiles: edit your own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- friendships --------------------------------------------------------------------
create policy "friendships: see your own"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

create policy "friendships: send a request"
  on public.friendships for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and status = 'pending'
    and not exists (
      select 1 from public.blocks bl
      where (bl.blocker_id = requester_id and bl.blocked_id = addressee_id)
         or (bl.blocker_id = addressee_id and bl.blocked_id = requester_id)
    )
  );

revoke update on public.friendships from authenticated;
grant update (status, responded_at) on public.friendships to authenticated;

create policy "friendships: accept a request sent to you"
  on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid()))
  with check (addressee_id = (select auth.uid()));

create policy "friendships: either side can remove"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- blocks -------------------------------------------------------------------------
create policy "blocks: see your own"
  on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy "blocks: block someone"
  on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));

create policy "blocks: unblock"
  on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- outfits ------------------------------------------------------------------------
create policy "outfits: see yours and friends'"
  on public.outfits for select to authenticated
  using (public.can_view_user(user_id));

create policy "outfits: post your own"
  on public.outfits for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke update on public.outfits from authenticated;
grant update (caption, worn_on, rank_key) on public.outfits to authenticated;

create policy "outfits: edit your own"
  on public.outfits for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "outfits: delete your own"
  on public.outfits for delete to authenticated
  using (user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- Storage: private bucket for outfit photos.
-- Files live at "<user_id>/<random uuid>.jpg".
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('outfit-photos', 'outfit-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create policy "outfit photos: upload into your own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'outfit-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- You can view a photo if it's in your folder, or if you can see the outfit
-- that uses it. The outfits check runs with the outfits RLS above, so photo
-- access always matches outfit access.
create policy "outfit photos: view yours, or ones on outfits you can see"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'outfit-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.outfits o where o.photo_path = storage.objects.name)
    )
  );

create policy "outfit photos: delete your own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'outfit-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
