-- =============================================================================
-- Tighten table permissions for the app's database roles.
--
-- On the hosted project, Supabase's default privileges also gave the
-- `authenticated` and `anon` roles TRUNCATE, TRIGGER, and REFERENCES on every
-- new table. TRUNCATE empties a whole table and is NOT checked by Row Level
-- Security. The app never needs these, so we remove them.
--
-- Pattern from here on: revoke everything, then grant exactly what each
-- table needs. RLS policies still decide which rows.
-- =============================================================================

revoke all on public.profiles, public.friendships, public.blocks,
              public.outfits, public.detection_jobs
  from anon, authenticated;

-- profiles: read (RLS: yourself and friends) and edit a few of your own columns.
-- Rows are created by the sign-up trigger, never by users directly.
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_path, is_private) on public.profiles to authenticated;

-- friendships: see, request, accept (status columns only), remove.
grant select, insert, delete on public.friendships to authenticated;
grant update (status, responded_at) on public.friendships to authenticated;

-- blocks: see, block, unblock.
grant select, insert, delete on public.blocks to authenticated;

-- outfits: see, post, edit a few columns, delete.
grant select, insert, delete on public.outfits to authenticated;
grant update (caption, worn_on, rank_key) on public.outfits to authenticated;

-- detection_jobs: no access for app users (the worker uses a privileged role).

-- Stop Supabase's default privileges from handing these roles broad rights
-- on tables created later. Each new table must grant access explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
