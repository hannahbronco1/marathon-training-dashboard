// Cloudflare Worker entry point. Static files in /public are served by the
// assets binding; this handles the /api/* routes.

import { validateRun } from '../public/js/run-schema.js';
import {
  createRuns,
  deleteRun,
  isSupabaseConfigured,
  isValidId,
  listRuns,
  updateRun,
  UpstreamError,
} from './supabase.js';
import { getCoachReply, isCoachConfigured } from './coach.js';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_IMPORT_RUNS = 1000;
const MAX_COACH_RUNS = 60;
const MAX_QUESTION_LENGTH = 500;

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

// Anything that reads your data or spends API credit needs the passcode.
// Refuse outright if a service is configured but no passcode is set, so a
// deploy never ends up with an open, writable database.
async function requirePasscode(request, env) {
  if (!env.APP_PASSCODE) {
    throw new HttpError(503, 'Set the APP_PASSCODE secret before using Supabase or the coach.');
  }
  const header = request.headers.get('Authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !(await passcodeMatches(given, env.APP_PASSCODE))) {
    throw new HttpError(401, 'Passcode required.');
  }
}

function requireSupabase(env) {
  if (!isSupabaseConfigured(env)) throw new HttpError(404, 'Supabase is not configured.');
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/config' && method === 'GET') {
    const storage = isSupabaseConfigured(env) ? 'supabase' : 'local';
    const coach = isCoachConfigured(env);
    return json({ storage, coach, passcode: storage === 'supabase' || coach });
  }

  if (pathname === '/api/runs') {
    requireSupabase(env);
    await requirePasscode(request, env);
    if (method === 'GET') return json({ runs: await listRuns(env) });
    if (method === 'POST') {
      const run = validateOrThrow(await readJson(request));
      const [created] = await createRuns(env, [run]);
      return json({ run: created }, 201);
    }
  }

  // Bulk upload of runs saved in the browser before Supabase was set up.
  if (pathname === '/api/runs/import' && method === 'POST') {
    requireSupabase(env);
    await requirePasscode(request, env);
    const body = await readJson(request);
    if (!Array.isArray(body.runs) || body.runs.length > MAX_IMPORT_RUNS) {
      throw new HttpError(400, `Send up to ${MAX_IMPORT_RUNS} runs as { "runs": [...] }.`);
    }
    const runs = body.runs.map(validateOrThrow);
    const created = runs.length ? await createRuns(env, runs) : [];
    return json({ runs: created }, 201);
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && runMatch[1] !== 'import') {
    requireSupabase(env);
    await requirePasscode(request, env);
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

  if (pathname === '/api/coach' && method === 'POST') {
    if (!isCoachConfigured(env)) throw new HttpError(404, 'The coach is not configured.');
    await requirePasscode(request, env);
    const body = await readJson(request);
    const unit = body.unit === 'mi' ? 'mi' : 'km';
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION_LENGTH) : '';
    if (!Array.isArray(body.runs)) throw new HttpError(400, 'Send your recent runs as { "runs": [...] }.');
    const runs = body.runs.slice(0, MAX_COACH_RUNS).map(validateOrThrow);
    return json({ reply: await getCoachReply(env, runs, unit, question) });
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
      if (err instanceof UpstreamError) {
        console.error(err.message, err.detail);
        return json({ error: `${err.service} request failed (${err.status}).` }, 502);
      }
      console.error(err);
      return json({ error: 'Something went wrong.' }, 500);
    }
  },
};
