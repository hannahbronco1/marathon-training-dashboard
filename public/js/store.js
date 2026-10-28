// Talks to the Worker's /api routes, which read and write Supabase.

const PASSCODE_KEY = 'mtd.passcode';

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

// The passcode is remembered on this device so you only type it once.
export const passcode = {
  get() {
    try {
      return localStorage.getItem(PASSCODE_KEY);
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      localStorage.setItem(PASSCODE_KEY, value);
    } catch {
      // Private browsing: you'll be asked again next visit.
    }
  },
};

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const code = passcode.get();
  if (code) headers.Authorization = `Bearer ${code}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`, data.fields);
  return data;
}

// { configured, missing: [secret names] }. Throws if the server can't be reached.
export function fetchConfig() {
  return api('/api/config');
}

export const runsApi = {
  list: async () => (await api('/api/runs')).runs,
  create: async (run) => (await api('/api/runs', { method: 'POST', body: run })).run,
  update: async (id, run) => (await api(`/api/runs/${encodeURIComponent(id)}`, { method: 'PATCH', body: run })).run,
  remove: (id) => api(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
