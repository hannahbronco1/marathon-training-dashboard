# Marathon Log

A phone-friendly dashboard for training for the ASICS Los Angeles Marathon (March 7, 2027). Log each run, then follow your progress in a sortable run log, a timeline, weekly summaries and charts.

It runs on **Cloudflare Workers** (static files plus a small API) and saves runs in **Supabase**. An optional `/api/chat` route sends chat requests to an NVIDIA-hosted model.

## What's in each run

Date, Week # and Day # (filled in from the date; you can change them), miles, duration (hh:mm:ss), pace (calculated), temperature (°F), conditions, inside/outside, run type (easy, long, tempo, race, other), pre-run / during / post-run food and drink, and notes. Food and notes are saved exactly as you type them. A split run is one entry with the combined miles and time.

Plan weeks run Monday to Sunday. Week 1 is Oct 19–25, 2026, and Week 20 (Mar 1–7, 2027) ends on race day. To change the plan dates, edit `public/js/plan.js`.

## How it fits together

```
public/              The website (no build step)
  index.html         Page layout: views, add/edit form, tab bar
  css/styles.css     Styles, including dark mode
  js/app.js          Everything you see and tap: form, run log, timeline, weekly, charts
  js/run-schema.js   The rules for a valid run (used by the browser AND the server)
  js/stats.js        Plan weeks, pace, totals (pure functions, easy to test)
  js/plan.js         Plan start date and race date
  js/charts.js       Small SVG charts
  js/store.js        Talks to the server's /api routes
src/                 The Cloudflare Worker (server)
  index.js           /api routes and the passcode check
  supabase.js        Reads and writes the Supabase runs table
  nvidia.js          Chat requests to NVIDIA (optional)
supabase/migrations/ SQL that creates the runs table
test/                Automated tests (npm test)
```

Your phone only ever talks to the Worker. The Worker holds the Supabase key and checks your passcode, so the key never reaches the browser.

## 1. Create the database table

1. In Supabase, open **SQL Editor** → **New query**.
2. Paste in everything from [`supabase/migrations/20261029000000_create_runs.sql`](supabase/migrations/20261029000000_create_runs.sql) and click **Run**.
3. From **Project Settings** → **API**, copy the **Project URL** and the **service_role** key.

Row level security is on with no policies, so the public `anon` key can't read or change anything. Never put the service role key in browser code.

## 2. Run it on your computer (optional)

Requires Node 20 or newer.

```bash
npm install
```

Copy `.dev.vars.example` to `.dev.vars` and fill in the three values, then:

```bash
npm run dev
```

Open http://localhost:8787.

```bash
npm test
```

## 3. Deploy to Cloudflare

Connect this GitHub repository to a Worker in the Cloudflare dashboard (Workers Builds) so each push deploys automatically. Or deploy from your computer:

```bash
npx wrangler login
```

```bash
npm run deploy
```

Then, in Cloudflare, open the Worker → **Settings** → **Variables and Secrets** and add these as type **Secret**:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service_role key |
| `APP_PASSCODE` | A long passcode you make up |
| `NVIDIA_API_KEY` | Optional: your NVIDIA API key from [build.nvidia.com](https://build.nvidia.com), for `/api/chat` |

On your phone, open the `*.workers.dev` URL, enter your passcode once, and use **Add to Home Screen** for an app icon.

## Privacy and the passcode

`APP_PASSCODE` protects your runs. The API refuses every request until it's set. Your phone asks for it once and remembers it on that device. For stronger protection, put the site behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/), which is free for personal use.

## API

All `/api/runs` and `/api/chat` routes need `Authorization: Bearer <APP_PASSCODE>`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/config` | | `{ configured }` |
| GET | `/api/runs` | | `{ runs }` |
| POST | `/api/runs` | run | `{ run }` |
| PATCH | `/api/runs/:id` | run | `{ run }` |
| DELETE | `/api/runs/:id` | | 204 |
| POST | `/api/chat` | `{ prompt }` or `{ messages, max_tokens? }` | `{ reply, finish_reason, model, usage }` |

`/api/chat` uses the model `nvidia/nemotron-3.5-lightning-30b-a3b` at `https://integrate.api.nvidia.com/v1`. `messages` is a list of `{ role, content }` with roles `system`, `user` or `assistant` (up to 40). `max_tokens` defaults to 1024 (max 4096). Any `<think>…</think>` reasoning is stripped from `reply`.

A run is:

```json
{
  "run_date": "2026-10-27",
  "plan_week": 2,
  "plan_day": 1,
  "miles": 6.25,
  "duration_seconds": 3300,
  "temperature_f": 61.5,
  "conditions": "sunny",
  "location": "outside",
  "run_type": "easy",
  "food_pre": "toast + coffee",
  "food_during": null,
  "food_post": "chocolate milk",
  "notes": "Felt strong."
}
```
