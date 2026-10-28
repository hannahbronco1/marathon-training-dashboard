-- Runs logged from the dashboard. Distances are stored in kilometres;
-- the app converts to miles for display.
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  distance_km numeric(6, 2) not null check (distance_km > 0 and distance_km <= 500),
  duration_seconds integer not null check (duration_seconds > 0 and duration_seconds <= 172800),
  run_type text not null default 'easy'
    check (run_type in ('easy', 'long', 'tempo', 'intervals', 'recovery', 'race')),
  effort smallint check (effort between 1 and 10),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runs_run_date_idx on public.runs (run_date desc, created_at desc);

-- Row level security on with no policies: the public anon key can't read or
-- write anything. Only the Cloudflare Worker, using the service role key,
-- can reach this table.
alter table public.runs enable row level security;
