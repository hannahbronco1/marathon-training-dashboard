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

async function rest(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
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
