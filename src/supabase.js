// Minimal client for Supabase's REST API (PostgREST). Runs server-side in
// the Worker with the service role key, which never reaches the browser.

const COLUMNS = [
  'id',
  'run_date',
  'plan_week',
  'plan_day',
  'miles',
  'duration_seconds',
  'temperature_f',
  'conditions',
  'location',
  'run_type',
  'food_pre',
  'food_during',
  'food_post',
  'notes',
  'created_at',
  'updated_at',
].join(',');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UpstreamError extends Error {
  constructor(service, status, detail) {
    super(`${service} responded with ${status}`);
    this.service = service;
    this.status = status;
    this.detail = detail;
  }
}

export function isSupabaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function isValidId(id) {
  return UUID.test(id);
}

// Newer Supabase secret keys (sb_secret_...) aren't JWTs and go in the
// apikey header only. Legacy service_role keys (eyJ...) also need to be sent
// as a Bearer token.
function authHeaders(key) {
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

async function rest(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const res = await fetch(`${env.SUPABASE_URL.trim().replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...authHeaders(key),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  });
  if (!res.ok) throw new UpstreamError('Supabase', res.status, await res.text());
  return res.status === 204 ? null : res.json();
}

export function listRuns(env) {
  return rest(env, `runs?select=${COLUMNS}&order=run_date.desc,plan_day.desc&limit=5000`);
}

export async function createRun(env, run) {
  const rows = await rest(env, `runs?select=${COLUMNS}`, { method: 'POST', body: JSON.stringify(run) });
  return rows[0];
}

// Inserts many runs in one request; returns the saved rows.
export function createRuns(env, runs) {
  return runs.length ? rest(env, `runs?select=${COLUMNS}`, { method: 'POST', body: JSON.stringify(runs) }) : [];
}

// Returns the updated row, or null when no run has that id.
export async function updateRun(env, id, run) {
  const rows = await rest(env, `runs?id=eq.${id}&select=${COLUMNS}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...run, updated_at: new Date().toISOString() }),
  });
  return rows[0] ?? null;
}

// Returns true when a run was deleted.
export async function deleteRun(env, id) {
  const rows = await rest(env, `runs?id=eq.${id}&select=id`, { method: 'DELETE' });
  return rows.length > 0;
}

// ---------- Weekly targets ----------

const TARGET_COLUMNS = 'plan_week,target_miles,updated_at';

export function listTargets(env) {
  return rest(env, `week_targets?select=${TARGET_COLUMNS}&order=plan_week.asc`);
}

// Creates or replaces the target for one plan week.
export async function upsertTarget(env, target) {
  const rows = await rest(env, `week_targets?on_conflict=plan_week&select=${TARGET_COLUMNS}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ ...target, updated_at: new Date().toISOString() }),
  });
  return rows[0];
}

// Returns true when a target was deleted.
export async function deleteTarget(env, week) {
  const rows = await rest(env, `week_targets?plan_week=eq.${week}&select=plan_week`, { method: 'DELETE' });
  return rows.length > 0;
}
