-- Runs logged from the dashboard. One row per run; a split run is one row
-- with the combined miles and time.
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),

  run_date date not null,
  plan_week smallint not null check (plan_week between 1 and 99),  -- week of the plan
  plan_day smallint not null check (plan_day between 1 and 14),    -- nth run of that week

  miles numeric(5, 2) not null check (miles > 0 and miles <= 200),
  duration_seconds integer not null check (duration_seconds > 0 and duration_seconds <= 172800),

  temperature_f numeric(4, 1) not null check (temperature_f between -60 and 140),
  conditions text check (char_length(conditions) <= 200),           -- e.g. sunny, humid
  location text not null check (location in ('inside', 'outside')),
  run_type text not null check (run_type in ('easy', 'long', 'tempo', 'race', 'other')),

  -- Journal fields, stored exactly as written.
  food_pre text check (char_length(food_pre) <= 1000),
  food_during text check (char_length(food_during) <= 1000),
  food_post text check (char_length(food_post) <= 1000),
  notes text check (char_length(notes) <= 5000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runs_run_date_idx on public.runs (run_date desc, plan_day desc);

-- Row level security on with no policies: the public anon key can't read or
-- write anything. Only the Cloudflare Worker, using the service role key,
-- can reach this table.
alter table public.runs enable row level security;
