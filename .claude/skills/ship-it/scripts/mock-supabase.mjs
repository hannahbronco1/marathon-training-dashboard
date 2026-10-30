// Tiny in-memory stand-in for Supabase's REST API: just the `runs` and
// `week_targets` calls the Worker makes. For local testing when the real Supabase isn't reachable.
//
//   node .claude/skills/ship-it/scripts/mock-supabase.mjs        (port 54321)
//
// Pair it with a .dev.vars that points the Worker here:
//   SUPABASE_URL=http://127.0.0.1:54321
//   SUPABASE_SERVICE_ROLE_KEY=test-service-key
//   APP_PASSCODE=<anything>
//
// Data lives in memory and is gone when the process stops. Set
// MOCK_NO_TARGETS=1 to act as if the week_targets table hasn't been created.

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 54321);
const KEY = 'test-service-key';
const rows = [];
const targets = new Map(); // plan_week -> row

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.headers.apikey !== KEY) return send(res, 401, { message: 'Invalid API key' });
    let body = '';
    for await (const chunk of req) body += chunk;

    if (url.pathname === '/rest/v1/week_targets') {
      if (process.env.MOCK_NO_TARGETS) return send(res, 404, { code: 'PGRST205', message: 'Could not find the table' });
      const week = Number(url.searchParams.get('plan_week')?.replace(/^eq\./, ''));
      if (req.method === 'GET') return send(res, 200, [...targets.values()].sort((a, b) => a.plan_week - b.plan_week));
      if (req.method === 'POST') {
        // Upsert on plan_week, as Prefer: resolution=merge-duplicates asks.
        const input = JSON.parse(body);
        const row = { ...input, target_miles: String(input.target_miles) };
        targets.set(row.plan_week, row);
        return send(res, 201, [row]);
      }
      if (req.method === 'DELETE') {
        const row = targets.get(week);
        targets.delete(week);
        return send(res, 200, row ? [{ plan_week: week }] : []);
      }
      return send(res, 405, { message: 'Method not allowed' });
    }
    if (url.pathname !== '/rest/v1/runs') return send(res, 404, { message: 'Not found' });

    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    const now = new Date().toISOString();

    if (req.method === 'GET') {
      const sorted = [...rows].sort((a, b) => b.run_date.localeCompare(a.run_date) || b.plan_day - a.plan_day);
      return send(res, 200, sorted);
    }
    if (req.method === 'POST') {
      // One run or an array of runs (bulk import).
      const parsed = JSON.parse(body);
      // Supabase returns numeric columns as strings; mimic that.
      const added = (Array.isArray(parsed) ? parsed : [parsed]).map((input) => ({
        id: randomUUID(),
        ...input,
        miles: String(input.miles),
        created_at: now,
        updated_at: now,
      }));
      rows.push(...added);
      return send(res, 201, added);
    }

    const index = rows.findIndex((r) => r.id === id);
    if (req.method === 'PATCH') {
      if (index < 0) return send(res, 200, []);
      Object.assign(rows[index], JSON.parse(body));
      return send(res, 200, [rows[index]]);
    }
    if (req.method === 'DELETE') {
      if (index < 0) return send(res, 200, []);
      const [removed] = rows.splice(index, 1);
      return send(res, 200, [{ id: removed.id }]);
    }
    send(res, 405, { message: 'Method not allowed' });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock Supabase on http://127.0.0.1:${PORT}`));
