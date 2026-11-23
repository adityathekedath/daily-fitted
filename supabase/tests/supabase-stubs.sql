-- Minimal stand-ins for the parts of Supabase our migrations depend on, so the
-- migrations and RLS policies can be tested in a plain Postgres (PGlite) with
-- no Docker. They mirror Supabase's behavior closely but are not identical:
-- before launch, also run these checks against a real Supabase project.

create role anon nologin;
create role authenticated nologin;

-- Supabase grants table access to these roles by default and relies on RLS.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

-- auth -----------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Same logic as Supabase's auth.uid(): the "sub" claim of the request's JWT.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

-- storage --------------------------------------------------------------------
create schema storage;
grant usage on schema storage to anon, authenticated;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text not null,
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;

-- Folder parts of a path: 'a/b/c.jpg' -> {a,b}
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
