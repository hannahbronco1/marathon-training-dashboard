// Cloudflare Worker entry point. Static files in /public are served by the
// assets binding; this handles the /api/* routes.

import { validateRun } from '../public/js/run-schema.js';
import {
  createRun,
  deleteRun,
  isSupabaseConfigured,
  isValidId,
  listRuns,
  updateRun,
  UpstreamError,
} from './supabase.js';
import { chat, isNvidiaConfigured, parseChatRequest, TimeoutError } from './nvidia.js';

const MAX_BODY_BYTES = 64 * 1024;
const REQUIRED_SECRETS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_PASSCODE'];

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

function validateOrThrow(input) {
  const { value, errors } = validateRun(input);
  if (errors) throw new HttpError(422, 'Some fields need fixing.', errors);
  return value;
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Compares hashes so the check takes the same time whatever the input.
async function passcodeMatches(given, expected) {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Reading or changing runs needs the passcode. Refuse outright if no
// passcode is set, so a deploy never ends up with an open database.
async function requirePasscode(request, env) {
  if (!env.APP_PASSCODE) {
    throw new HttpError(503, 'Set the APP_PASSCODE secret before using the dashboard.');
  }
  const header = request.headers.get('Authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !(await passcodeMatches(given, env.APP_PASSCODE))) {
    throw new HttpError(401, 'Passcode required.');
  }
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  // Says which secrets are missing (names only, never values) so the setup
  // screen can show what's left to add.
  if (pathname === '/api/config' && method === 'GET') {
    const missing = REQUIRED_SECRETS.filter((name) => !String(env[name] ?? '').trim());
    const chat = isNvidiaConfigured(env);
    const body = { configured: missing.length === 0, missing, chat };
    // When chat is off, list any NVIDIA-looking secret names the Worker can
    // see (names only, plus whether each is empty) to help spot typos.
    if (!chat) {
      body.nvidiaSecretsSeen = Object.keys(env)
        .filter((name) => /nvidia/i.test(name))
        .map((name) => ({ name, empty: !String(env[name] ?? '').trim() }));
    }
    return json(body);
  }

  if (pathname === '/api/runs' || pathname.startsWith('/api/runs/')) {
    if (!isSupabaseConfigured(env)) throw new HttpError(503, 'Supabase is not set up yet.');
    await requirePasscode(request, env);
  }

  if (pathname === '/api/runs') {
    if (method === 'GET') return json({ runs: await listRuns(env) });
    if (method === 'POST') {
      const run = await createRun(env, validateOrThrow(await readJson(request)));
      return json({ run }, 201);
    }
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    const id = runMatch[1];
    if (!isValidId(id)) throw new HttpError(404, 'Run not found.');
    if (method === 'PATCH' || method === 'PUT') {
      const updated = await updateRun(env, id, validateOrThrow(await readJson(request)));
      if (!updated) throw new HttpError(404, 'Run not found.');
      return json({ run: updated });
    }
    if (method === 'DELETE') {
      if (!(await deleteRun(env, id))) throw new HttpError(404, 'Run not found.');
      return new Response(null, { status: 204 });
    }
  }

  // Sends a chat request to NVIDIA. Passcode-protected so nobody else can
  // spend your NVIDIA credits.
  if (pathname === '/api/chat' && method === 'POST') {
    if (!isNvidiaConfigured(env)) throw new HttpError(503, 'Set the NVIDIA_API_KEY secret to use chat.');
    await requirePasscode(request, env);
    const { value, error } = parseChatRequest(await readJson(request));
    if (error) throw new HttpError(400, error);
    return json(await chat(env, value));
  }

  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message, ...(err.details && { fields: err.details }) }, err.status);
      }
      if (err instanceof TimeoutError) return json({ error: err.message }, 504);
      if (err instanceof UpstreamError) {
        console.error(err.message, err.detail);
        return json({ error: `${err.service} request failed (${err.status}).` }, 502);
      }
      console.error(err);
      return json({ error: 'Something went wrong.' }, 500);
    }
  },
};
