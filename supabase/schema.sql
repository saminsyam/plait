-- plAIt · scan corpus (Sushi 2.1, Phase 0+1)
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Also required, in the dashboard:
--   Authentication → Sign In / Up → enable "Anonymous sign-ins"
-- (the app signs in anonymously on first write; RLS keys on that auth.uid()).

create table public.scan_traces (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id),
  -- Client-generated id linking a 'scan' trace to its 'rank' traces.
  scan_id    text not null,
  kind       text not null check (kind in ('scan', 'rank')),
  restaurant text not null default '',
  cuisine    text not null default '',
  -- 'scan': items + menu_context + gate split + profile snapshot.
  -- 'rank': mode, pool_ids, questions/answers, crowd_map, slate (with suits).
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index scan_traces_scan_id_idx on public.scan_traces (scan_id);
create index scan_traces_created_at_idx on public.scan_traces (created_at desc);

alter table public.scan_traces enable row level security;

create policy "own rows: insert"
  on public.scan_traces for insert to authenticated
  with check (auth.uid() = user_id);

create policy "own rows: select"
  on public.scan_traces for select to authenticated
  using (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Phase 3 · menu cache (added after scan_traces — if your project already has
-- scan_traces, copy and run JUST this section in the SQL editor).
--
-- One row per (user, restaurant): the raw vision read. "Recent places" on the
-- camera screen loads it back and skips the vision call entirely; the hard
-- gate re-runs at load time against the CURRENT profile, so cached menus are
-- exactly as safe as fresh scans.

create table public.menu_cache (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id),
  -- Normalized restaurant name (lowercase, collapsed spaces) — the lookup key.
  restaurant_key text not null,
  restaurant     text not null,
  cuisine        text not null default '',
  -- { items, menu_context } exactly as callVision returned them.
  payload        jsonb not null,
  scanned_at     timestamptz not null default now(),
  unique (user_id, restaurant_key)
);

create index menu_cache_scanned_at_idx on public.menu_cache (user_id, scanned_at desc);

alter table public.menu_cache enable row level security;

create policy "own rows: insert"
  on public.menu_cache for insert to authenticated
  with check (auth.uid() = user_id);

create policy "own rows: update"
  on public.menu_cache for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows: select"
  on public.menu_cache for select to authenticated
  using (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Phase 3 · shared review cache (run JUST this section on existing projects).
--
-- Crowd-favorite search results are public web data, so this cache is SHARED:
-- any signed-in user reads and refreshes the same per-restaurant row. One
-- web search per restaurant TOTAL (not per device, not per reinstall). The
-- 14-day TTL is enforced client-side against fetched_at.

create table public.review_cache (
  id             uuid primary key default gen_random_uuid(),
  -- Normalized restaurant name (see normalizeRestaurantName) — globally unique.
  restaurant_key text not null unique,
  restaurant     text not null,
  -- ReviewsResult as returned by the review search (found:true only).
  payload        jsonb not null,
  fetched_by     uuid not null default auth.uid() references auth.users (id),
  fetched_at     timestamptz not null default now()
);

alter table public.review_cache enable row level security;

create policy "shared: select"
  on public.review_cache for select to authenticated
  using (true);

create policy "shared: insert"
  on public.review_cache for insert to authenticated
  with check (true);

create policy "shared: update"
  on public.review_cache for update to authenticated
  using (true) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- Phase 3 · dish-detail cache (run JUST this section on existing projects).
--
-- The lazy "tell me more" sheet call, cached PER USER — details are
-- personalized (they reference the user's constraints and answers), so no
-- sharing. Key = restaurant | dish | hash(preferences + answers). 30-day TTL
-- enforced client-side against created_at.

create table public.dish_detail_cache (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id),
  cache_key  text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, cache_key)
);

alter table public.dish_detail_cache enable row level security;

create policy "own rows: insert"
  on public.dish_detail_cache for insert to authenticated
  with check (auth.uid() = user_id);

create policy "own rows: update"
  on public.dish_detail_cache for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows: select"
  on public.dish_detail_cache for select to authenticated
  using (auth.uid() = user_id);
