import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const SUPABASE_URL = 'https://example.supabase.co';
const ID = '6f1c1f4e-8f4a-4d7e-9a57-3a1b2c3d4e5f';
const run = {
  run_date: '2026-10-28',
  plan_week: 2,
  plan_day: 1,
  miles: 6.2,
  duration_seconds: 3000,
  temperature_f: 60,
  location: 'outside',
  run_type: 'easy',
}

const assets = { fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }) };
const fullEnv = {
  ASSETS: assets,
  APP_PASSCODE: 'letmein',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

let realFetch;
let calls;
let respond;

beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
  respond = () => new Response('[]', { status: 200 });
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function call(path, { method = 'GET', body, auth = 'letmein', env = fullEnv } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://app.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return worker.fetch(request, env);
}

test('non-API paths go to static assets', async () => {
  const res = await call('/', { auth: null });
  assert.equal(await res.text(), '<!doctype html>');
});

test('config lists missing secrets by name only', async () => {
  const off = await call('/api/config', { auth: null, env: { ASSETS: assets } });
  assert.deepEqual(await off.json(), {
    configured: false,
    missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_PASSCODE'],
    chat: false,
    nvidiaSecretsSeen: [],
  });
  const blank = await call('/api/config', { auth: null, env: { ...fullEnv, SUPABASE_SERVICE_ROLE_KEY: '  ' } });
  assert.deepEqual(await blank.json(), {
    configured: false,
    missing: ['SUPABASE_SERVICE_ROLE_KEY'],
    chat: false,
    nvidiaSecretsSeen: [],
  });
  const on = await call('/api/config', { auth: null });
  const body = await on.text();
  assert.deepEqual(JSON.parse(body), { configured: true, missing: [], chat: false, nvidiaSecretsSeen: [] });
  const withChat = await call('/api/config', { auth: null, env: { ...fullEnv, NVIDIA_API_KEY: 'nvapi-x' } });
  const withChatBody = await withChat.json();
  assert.equal(withChatBody.chat, true);
  assert.equal(withChatBody.nvidiaSecretsSeen, undefined);
  const typo = await call('/api/config', { auth: null, env: { ...fullEnv, 'NVIDIA_API_Key ': 'nvapi-secret-value', NVIDIA_OTHER: '' } });
  const typoText = await typo.text();
  assert.deepEqual(JSON.parse(typoText).nvidiaSecretsSeen, [
    { name: 'NVIDIA_API_Key ', empty: false },
    { name: 'NVIDIA_OTHER', empty: true },
  ]);
  assert.doesNotMatch(typoText, /nvapi-secret-value/);
  assert.doesNotMatch(body, /service-key|letmein/);
});

test('runs need Supabase configured', async () => {
  const res = await call('/api/runs', { env: { ASSETS: assets } });
  assert.equal(res.status, 503);
});

test('runs refuse to work without APP_PASSCODE set', async () => {
  const { APP_PASSCODE, ...env } = fullEnv;
  const res = await call('/api/runs', { env });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('runs reject a missing or wrong passcode', async () => {
  assert.equal((await call('/api/runs', { auth: null })).status, 401);
  assert.equal((await call('/api/runs', { auth: 'nope' })).status, 401);
  assert.equal(calls.length, 0);
});

test('lists runs from Supabase with the service key', async () => {
  respond = () => Response.json([{ id: ID, ...run }]);
  const res = await call('/api/runs');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).runs, [{ id: ID, ...run }]);
  assert.match(calls[0].url, /^https:\/\/example\.supabase\.co\/rest\/v1\/runs\?select=/);
  assert.equal(calls[0].init.headers.apikey, 'service-key');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer service-key');
});

test('new-style secret keys go in the apikey header only', async () => {
  respond = () => Response.json([]);
  const env = { ...fullEnv, SUPABASE_SERVICE_ROLE_KEY: ' sb_secret_abc123 ', SUPABASE_URL: `${SUPABASE_URL}/ ` };
  assert.equal((await call('/api/runs', { env })).status, 200);
  assert.equal(calls[0].init.headers.apikey, 'sb_secret_abc123');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.match(calls[0].url, /^https:\/\/example\.supabase\.co\/rest\/v1\/runs\?/);
});

test('creates a validated run', async () => {
  respond = (url, init) => Response.json([{ id: ID, ...JSON.parse(init.body) }], { status: 201 });
  const notes = '  Legs heavy.\nStill fun.  ';
  const res = await call('/api/runs', { method: 'POST', body: { ...run, id: 'forged', notes } });
  assert.equal(res.status, 201);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.id, undefined);
  assert.equal(sent.notes, notes);
  assert.equal((await res.json()).run.id, ID);
});

test('rejects an invalid run with field errors', async () => {
  const res = await call('/api/runs', { method: 'POST', body: { ...run, miles: 0, plan_day: 1.5 } });
  assert.equal(res.status, 422);
  const { fields } = await res.json();
  assert.ok(fields.miles);
  assert.ok(fields.plan_day);
  assert.equal(calls.length, 0);
});

test('rejects malformed JSON', async () => {
  const res = await call('/api/runs', { method: 'POST', body: '{nope' });
  assert.equal(res.status, 400);
});

test('updates and deletes by id', async () => {
  respond = (url, init) => Response.json([{ id: ID, ...(init.body ? JSON.parse(init.body) : {}) }]);
  const updated = await call(`/api/runs/${ID}`, { method: 'PATCH', body: { ...run, miles: 12 } });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).run.miles, 12);
  assert.match(calls[0].url, new RegExp(`id=eq\\.${ID}`));
  assert.equal(calls[0].init.method, 'PATCH');

  const deleted = await call(`/api/runs/${ID}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
});

test('unknown or malformed ids are 404 without hitting Supabase', async () => {
  respond = () => Response.json([]);
  assert.equal((await call(`/api/runs/${ID}`, { method: 'DELETE' })).status, 404);
  assert.equal(calls.length, 1);
  assert.equal((await call('/api/runs/1;drop', { method: 'DELETE' })).status, 404);
  assert.equal(calls.length, 1);
});

test('Supabase errors become a 502 without leaking details', async () => {
  respond = () => new Response('secret internals', { status: 500 });
  const res = await call('/api/runs');
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /secret internals/);
});

test('removed routes are gone', async () => {
  assert.equal((await call('/api/coach', { method: 'POST', body: {} })).status, 404);
  assert.equal((await call('/api/runs/import', { method: 'POST', body: {} })).status, 404);
});

test('lists weekly targets', async () => {
  respond = () => Response.json([{ plan_week: 2, target_miles: '20.00', updated_at: 'x' }]);
  const res = await call('/api/targets');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).targets[0].plan_week, 2);
  assert.match(calls[0].url, /\/rest\/v1\/week_targets\?select=/);
});

test('sets a target with an upsert on the plan week', async () => {
  respond = (url, init) => Response.json([JSON.parse(init.body)]);
  const res = await call('/api/targets/3', { method: 'PUT', body: { target_miles: 22.5, plan_week: 99 } });
  assert.equal(res.status, 200);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.plan_week, 3); // the week in the URL wins
  assert.equal(sent.target_miles, 22.5);
  assert.match(calls[0].url, /on_conflict=plan_week/);
  assert.match(calls[0].init.headers.Prefer, /resolution=merge-duplicates/);
});

test('rejects a bad target and needs the passcode', async () => {
  assert.equal((await call('/api/targets/3', { method: 'PUT', body: { target_miles: 0 } })).status, 422);
  assert.equal((await call('/api/targets/3', { method: 'PUT', body: { target_miles: 20 }, auth: null })).status, 401);
  assert.equal((await call('/api/targets/abc', { method: 'PUT', body: { target_miles: 20 } })).status, 404);
  assert.equal(calls.length, 0);
});

test('removes a target, 404 when there was none', async () => {
  respond = () => Response.json([{ plan_week: 3 }]);
  assert.equal((await call('/api/targets/3', { method: 'DELETE' })).status, 204);
  respond = () => Response.json([]);
  assert.equal((await call('/api/targets/4', { method: 'DELETE' })).status, 404);
});

test('a missing targets table comes back as a Supabase 404', async () => {
  respond = () => new Response('{"code":"PGRST205"}', { status: 404 });
  const res = await call('/api/targets');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Supabase request failed \(404\)/);
});

const chatEnv = { ...fullEnv, NVIDIA_API_KEY: ' nvapi-test ' };

test('chat sends the request to NVIDIA with the right model and key', async () => {
  respond = () =>
    Response.json({
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      choices: [{ message: { content: '<think>planning…</think>\n\nHello there!' }, finish_reason: 'stop' }],
      usage: { total_tokens: 12 },
    });
  const res = await call('/api/chat', { method: 'POST', env: chatEnv, body: { prompt: 'Say hello' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    reply: 'Hello there!',
    finish_reason: 'stop',
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    usage: { total_tokens: 12 },
  });
  assert.equal(calls[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer nvapi-test');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    messages: [{ role: 'user', content: 'Say hello' }],
    max_tokens: 1024,
    stream: false,
  });
});

test('chat accepts a message list and max_tokens', async () => {
  respond = () => Response.json({ choices: [{ message: { content: 'Sure.' }, finish_reason: 'stop' }] });
  const messages = [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Hi', extra: 'dropped' },
  ];
  const res = await call('/api/chat', { method: 'POST', env: chatEnv, body: { messages, max_tokens: 200 } });
  assert.equal(res.status, 200);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.messages, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Hi' },
  ]);
  assert.equal(sent.max_tokens, 200);
});

test('chat needs the passcode and the NVIDIA key', async () => {
  assert.equal((await call('/api/chat', { method: 'POST', body: { prompt: 'hi' } })).status, 503);
  assert.equal((await call('/api/chat', { method: 'POST', env: chatEnv, auth: null, body: { prompt: 'hi' } })).status, 401);
  assert.equal(calls.length, 0);
});

test('chat rejects bad requests before calling NVIDIA', async () => {
  for (const body of [{}, { messages: [] }, { messages: [{ role: 'tool', content: 'x' }] }, { prompt: '   ' }, { prompt: 'hi', max_tokens: 99999 }]) {
    assert.equal((await call('/api/chat', { method: 'POST', env: chatEnv, body })).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test('chat hides NVIDIA error details and reports timeouts', async () => {
  respond = () => new Response('{"detail":"internal key info"}', { status: 401 });
  const failed = await call('/api/chat', { method: 'POST', env: chatEnv, body: { prompt: 'hi' } });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /internal key info/);

  respond = () => {
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  };
  const slow = await call('/api/chat', { method: 'POST', env: chatEnv, body: { prompt: 'hi' } });
  assert.equal(slow.status, 504);

  respond = () => {
    throw new TypeError('fetch failed');
  };
  const offline = await call('/api/chat', { method: 'POST', env: chatEnv, body: { prompt: 'hi' } });
  assert.equal(offline.status, 502);
  assert.match((await offline.json()).error, /NVIDIA request failed \(unreachable\)/);
});
