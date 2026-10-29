-- Optional weekly mileage targets, one per plan week, set by the runner.
-- Adds a new table only; the runs table is not touched. Safe to run twice.
create table if not exists public.week_targets (
  plan_week smallint primary key check (plan_week between 1 and 99),
  target_miles numeric(5, 2) not null check (target_miles > 0 and target_miles <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same rule as runs: only the Cloudflare Worker (service role key) can reach it.
alter table public.week_targets enable row level security;

-- Ask Supabase's API to notice the new table right away.
notify pgrst, 'reload schema';
