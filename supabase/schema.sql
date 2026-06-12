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
