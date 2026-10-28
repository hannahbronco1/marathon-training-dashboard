// Where runs are kept. With Supabase configured on the Worker, runs go
// through /api/runs. Without it, they stay in this browser's localStorage so
// the dashboard is usable before any backend is set up.

const LOCAL_RUNS_KEY = 'mtd.runs.v1';
const PASSCODE_KEY = 'mtd.passcode';

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export const passcode = {
  get: () => readStorage(PASSCODE_KEY),
  set: (value) => writeStorage(PASSCODE_KEY, value),
  clear: () => writeStorage(PASSCODE_KEY, null),
};

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const code = passcode.get();
  if (code) headers.Authorization = `Bearer ${code}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`, data.fields);
  return data;
}

async function fetchConfig() {
  try {
    return await api('/api/config');
  } catch {
    // Opened as plain static files, or the Worker is unreachable.
    return { storage: 'local', coach: false, passcode: false };
  }
}

function readLocalRuns() {
  try {
    const runs = JSON.parse(readStorage(LOCAL_RUNS_KEY) ?? '[]');
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

class LocalStore {
  kind = 'local';

  constructor(config) {
    this.config = config;
  }

  #save(runs) {
    if (!writeStorage(LOCAL_RUNS_KEY, JSON.stringify(runs))) {
      throw new ApiError(0, "This browser won't let the dashboard save data (private mode?).");
    }
  }

  async list() {
    return readLocalRuns();
  }

  async create(run) {
    const now = new Date().toISOString();
    const created = { ...run, id: newId(), created_at: now, updated_at: now };
    this.#save([...readLocalRuns(), created]);
    return created;
  }

  async update(id, run) {
    const runs = readLocalRuns();
    const index = runs.findIndex((r) => r.id === id);
    if (index === -1) throw new ApiError(404, 'Run not found.');
    runs[index] = { ...runs[index], ...run, updated_at: new Date().toISOString() };
    this.#save(runs);
    return runs[index];
  }

  async remove(id) {
    this.#save(readLocalRuns().filter((r) => r.id !== id));
  }

  // Runs saved in the browser that could be uploaded to a backend.
  localRuns() {
    return [];
  }
}

class RemoteStore {
  kind = 'supabase';

  constructor(config) {
    this.config = config;
  }

  async list() {
    return (await api('/api/runs')).runs;
  }

  async create(run) {
    return (await api('/api/runs', { method: 'POST', body: run })).run;
  }

  async update(id, run) {
    return (await api(`/api/runs/${encodeURIComponent(id)}`, { method: 'PATCH', body: run })).run;
  }

  async remove(id) {
    await api(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Runs logged on this device before Supabase was connected.
  localRuns() {
    return readLocalRuns();
  }

  async importLocalRuns() {
    const runs = readLocalRuns().map(({ run_date, distance_km, duration_seconds, run_type, effort, notes }) => ({
      run_date,
      distance_km,
      duration_seconds,
      run_type,
      effort,
      notes,
    }));
    await api('/api/runs/import', { method: 'POST', body: { runs } });
    writeStorage(LOCAL_RUNS_KEY, null);
  }
}

export async function createStore() {
  const config = await fetchConfig();
  return config.storage === 'supabase' ? new RemoteStore(config) : new LocalStore(config);
}

export async function askCoach(runs, unit, question) {
  return (await api('/api/coach', { method: 'POST', body: { runs, unit, question } })).reply;
}
