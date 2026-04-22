-- ============================================================================
-- BecauseILiked schema
-- Source of truth for all DDL applied via the Supabase SQL Editor through
-- Phase 3. Safe to run against a fresh Supabase project in order; idempotent
-- where possible.
--
-- Last updated: Phase 3 (pgvector, item_embeddings, match_items function)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------

create extension if not exists vector;  -- pgvector; enabled via Dashboard → Extensions


-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

do $$ begin
  create type medium_type as enum ('film', 'tv', 'book', 'game');
exception
  when duplicate_object then null;
end $$;


-- ============================================================================
-- profiles
-- ============================================================================

create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "Profiles are viewable by everyone" on profiles;
create policy "Profiles are viewable by everyone"
  on profiles for select using (true);

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on profiles;
create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- Auto-create a profile row on user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- items — unified catalog across all four media
-- ============================================================================

create table if not exists items (
  id                   uuid primary key default gen_random_uuid(),
  medium               medium_type not null,
  title                text not null,
  year                 int,
  creators             jsonb default '[]'::jsonb,
  synopsis             text,
  themes               text[] default array[]::text[],
  tone                 text[] default array[]::text[],
  external_ids         jsonb default '{}'::jsonb,
  poster_url           text,

  -- Phase 3: LLM-enriched description. Regenerated only when enrichment_version
  -- changes, so prompt tweaks don't force full re-enrichment of the catalog.
  enriched_description text,
  enrichment_version   text,
  enriched_at          timestamptz,

  -- Generated UID columns — one per source API.
  -- Derived from external_ids to provide a single, unique, stable identifier
  -- per catalog source. Using stored generated columns (not expression indexes)
  -- so ON CONFLICT targets work cleanly with the Supabase upsert API.
  tmdb_uid             text generated always as (external_ids->>'tmdb_uid') stored,
  olid_uid             text generated always as (external_ids->>'olid_uid') stored,
  igdb_uid             text generated always as (external_ids->>'igdb_uid') stored,

  created_at           timestamptz not null default now()
);

-- Indexes
create index if not exists items_medium_idx on items(medium);
create index if not exists items_title_idx on items using gin (to_tsvector('english', title));
create index if not exists items_enrichment_version_idx on items(enrichment_version);

-- Unique constraints per source (one item per source ID per medium).
-- Each constraint is only relevant for items that carry that source's ID;
-- rows without the corresponding external_id will have NULL in these columns
-- and are ignored by the uniqueness check (NULLs are distinct).
alter table items drop constraint if exists items_tmdb_uid_unique;
alter table items add constraint items_tmdb_uid_unique unique (tmdb_uid);

alter table items drop constraint if exists items_olid_uid_unique;
alter table items add constraint items_olid_uid_unique unique (olid_uid);

alter table items drop constraint if exists items_igdb_uid_unique;
alter table items add constraint items_igdb_uid_unique unique (igdb_uid);

-- Safety net: if a row declares a source ID (e.g. external_ids has 'tmdb_id'),
-- the corresponding UID column must be non-null. This catches NULL-silent-dedup
-- bugs where the seeder forgets to populate the UID key in external_ids.
alter table items drop constraint if exists items_tmdb_has_uid;
alter table items add constraint items_tmdb_has_uid
  check (not (external_ids ? 'tmdb_id') or tmdb_uid is not null);

alter table items drop constraint if exists items_olid_has_uid;
alter table items add constraint items_olid_has_uid
  check (not (external_ids ? 'olid') or olid_uid is not null);

alter table items drop constraint if exists items_igdb_has_uid;
alter table items add constraint items_igdb_has_uid
  check (not (external_ids ? 'igdb_id') or igdb_uid is not null);

-- RLS: catalog is public, no writes through the public API.
-- Writes happen only through seeder scripts using the service role key.
alter table items enable row level security;

drop policy if exists "Items are viewable by everyone" on items;
create policy "Items are viewable by everyone"
  on items for select using (true);


-- ============================================================================
-- user_loves — the heart of the app
-- ============================================================================

create table if not exists user_loves (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  item_id        uuid references items(id) on delete set null,
  free_text      text not null,
  freeform_title text,
  created_at     timestamptz not null default now()
);

create index if not exists user_loves_user_idx on user_loves(user_id);
create index if not exists user_loves_item_idx on user_loves(item_id);

-- A user can love a specific catalog item at most once. Freeform entries
-- (where item_id is null) are unrestricted because they describe different things.
drop index if exists user_loves_user_item_unique;
create unique index user_loves_user_item_unique
  on user_loves (user_id, item_id)
  where item_id is not null;

alter table user_loves enable row level security;

drop policy if exists "Users can view own loves" on user_loves;
create policy "Users can view own loves"
  on user_loves for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own loves" on user_loves;
create policy "Users can insert own loves"
  on user_loves for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own loves" on user_loves;
create policy "Users can update own loves"
  on user_loves for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own loves" on user_loves;
create policy "Users can delete own loves"
  on user_loves for delete using (auth.uid() = user_id);


-- ============================================================================
-- item_embeddings — Phase 3
-- ============================================================================
-- Split out from items so embeddings can be re-generated independently and
-- multiple embedding model versions can coexist. vector(1536) matches
-- text-embedding-3-small's output dimensionality.

create table if not exists item_embeddings (
  item_id           uuid references items(id) on delete cascade,
  embedding_version text not null,
  embedding         vector(1536) not null,
  embedded_at       timestamptz not null default now(),
  primary key (item_id, embedding_version)
);

-- HNSW index for fast approximate nearest-neighbour search via cosine distance.
-- Built empty; cost of the index is negligible until rows are added.
create index if not exists item_embeddings_vector_idx
  on item_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table item_embeddings enable row level security;

drop policy if exists "Embeddings are viewable by everyone" on item_embeddings;
create policy "Embeddings are viewable by everyone"
  on item_embeddings for select using (true);


-- ============================================================================
-- match_items — Phase 3
-- ============================================================================
-- Encapsulates the cosine-similarity nearest-neighbour query so app code
-- doesn't need to know the pgvector distance operator.
--
-- Returns items ordered by similarity to the query_embedding (most similar first).
-- Cosine distance is in [0, 2]; we convert to a 0..1 "similarity" score where
-- 1 = identical direction, 0 = orthogonal.

create or replace function match_items(
  query_embedding          vector(1536),
  match_medium             medium_type default null,
  match_count              int default 30,
  exclude_item_ids         uuid[] default array[]::uuid[],
  embedding_version_filter text default 'v1'
)
returns table (
  item_id     uuid,
  title       text,
  medium      medium_type,
  year        int,
  poster_url  text,
  similarity  float
)
language plpgsql
stable
as $$
begin
  return query
  select
    i.id as item_id,
    i.title,
    i.medium,
    i.year,
    i.poster_url,
    1 - (ie.embedding <=> query_embedding) as similarity
  from item_embeddings ie
  join items i on i.id = ie.item_id
  where ie.embedding_version = embedding_version_filter
    and (match_medium is null or i.medium = match_medium)
    and i.id <> all(exclude_item_ids)
  order by ie.embedding <=> query_embedding
  limit match_count;
end;
$$;