# Marathon Log

A phone-friendly dashboard for marathon training. Log each run, then follow your progress as a timeline, weekly summaries and charts (weekly distance, long run, average pace).

It runs on **Cloudflare Workers** (static files + a small API), stores runs in **Supabase**, and can ask an **NVIDIA-hosted LLM** for coaching feedback. You don't need either service to start: without them, runs are saved in your browser.

## How it fits together

```
public/            Static site served by Cloudflare (no build step)
  index.html
  css/styles.css
  js/app.js        UI: dashboard, timeline, weekly view, log form
  js/charts.js     Dependency-free SVG charts
  js/stats.js      Weekly totals, pace, unit conversion (pure functions)
  js/store.js      Saves runs via the API, or in localStorage as a fallback
  js/run-schema.js Run validation, shared by the browser and the Worker
src/               The Worker (handles /api/*)
  index.js         Routes and the passcode check
  supabase.js      Supabase REST calls (service role key, server side only)
  coach.js         NVIDIA chat completions call
supabase/migrations/   SQL for the `runs` table
test/              node --test unit and API tests
```

The browser asks `/api/config` what's set up:

| Secrets set | Where runs are saved | Coach |
| --- | --- | --- |
| none | this browser (localStorage) | hidden |
| Supabase + `APP_PASSCODE` | Supabase | hidden |
| Supabase + NVIDIA + `APP_PASSCODE` | Supabase | shown |

If you connect Supabase after logging runs locally, the dashboard offers to upload them.

## Run it locally

Requires Node 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:8787. To try Supabase or the coach locally, copy `.dev.vars.example` to `.dev.vars` and fill it in.

```bash
npm test
```

## Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run [`supabase/migrations/20261028000000_create_runs.sql`](supabase/migrations/20261028000000_create_runs.sql). (With the Supabase CLI you can run `supabase db push` instead.)
3. From **Project Settings → API**, copy the project URL and the `service_role` key.

The table has row level security turned on with no policies, so the public `anon` key can't read or change anything. Only the Worker, using the service role key, can reach it. Never put the service role key in browser code.

## Set up the NVIDIA coach (optional)

1. Sign in at [build.nvidia.com](https://build.nvidia.com), open a model, and choose **Get API Key**.
2. Set it as `NVIDIA_API_KEY` (below).

The model is set by `NVIDIA_MODEL` in `wrangler.jsonc` (default `meta/llama-3.3-70b-instruct`). Any chat model from the NVIDIA API catalog works. The prompt is in `src/coach.js`.

## Deploy to Cloudflare

```bash
npx wrangler login
```

Set your secrets. Each command prompts for the value:

```bash
npx wrangler secret put APP_PASSCODE
```

```bash
npx wrangler secret put SUPABASE_URL
```

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

```bash
npx wrangler secret put NVIDIA_API_KEY
```

```bash
npm run deploy
```

Wrangler prints your `*.workers.dev` URL. On your phone, open it and use **Add to Home Screen** to get an app icon.

You can also connect this GitHub repository to the Worker in the Cloudflare dashboard (Workers Builds) so each push deploys automatically. Secrets set with `wrangler secret put` stay in place across deploys.

## Privacy and the passcode

`APP_PASSCODE` protects your data and your NVIDIA credits. Once Supabase or the coach is configured, the API refuses every request until `APP_PASSCODE` is set, and the browser asks for it once and remembers it on that device. Use a long, unique passcode. For stronger protection, put the site behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/), which is free for personal use.

## API

All routes except `/api/config` need `Authorization: Bearer <APP_PASSCODE>`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/config` | | `{ storage, coach, passcode }` |
| GET | `/api/runs` | | `{ runs }` |
| POST | `/api/runs` | run | `{ run }` |
| PATCH | `/api/runs/:id` | run | `{ run }` |
| DELETE | `/api/runs/:id` | | 204 |
| POST | `/api/runs/import` | `{ runs: [run] }` | `{ runs }` |
| POST | `/api/coach` | `{ runs, unit, question? }` | `{ reply }` |

A run is `{ run_date: "YYYY-MM-DD", distance_km, duration_seconds, run_type, effort?, notes? }`. `run_type` is one of `easy`, `long`, `tempo`, `intervals`, `recovery`, `race`, and `effort` is 1–10. Distances are stored in kilometres; the km/mi button only changes how they're shown.
