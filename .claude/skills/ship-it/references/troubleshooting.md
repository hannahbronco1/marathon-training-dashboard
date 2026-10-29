# Troubleshooting: everything learned the hard way

Contents:
1. Symptoms and fixes (match what the owner sees)
2. Secrets: where each one comes from and the rules
3. GitHub and Cloudflare builds
4. Diagnostics the site gives you
5. Testing locally
6. Quirks of this cloud session

---

## 1. Symptoms and fixes

Match the owner's screenshot or error text, then give the fix as one clear click path.

### On the website

| What they see | What it means | Fix |
| --- | --- | --- |
| **"Connect your database"** with every secret marked **✕ MISSING** | The running site sees none of the secrets. Almost always they were added under **Settings → Build → Variables and secrets** (build-time only), not the runtime section. | Add them under **Workers & Pages → marathon-training-dashboard → Settings → Variables and Secrets** (the card *not* inside Build), type **Secret**. Delete the Build copies afterwards. |
| **"Connect your database"** with only one or two **✕ MISSING** | Those names don't match exactly (capitals, a typo, a trailing space), or that secret wasn't saved. | Click into the name and check it letter by letter. If in doubt, delete it and add it again, typing the name by hand. |
| **"Couldn't reach the server: …"** | The page loaded, but `/api/config` failed. Either the Worker is erroring or the network is down. | Ask for the text after the colon. Check the latest build succeeded (**Deployments** tab). |
| **"Locked. Enter your passcode…"** / passcode prompt | Normal the first time on a device. | Enter `APP_PASSCODE`. It's remembered on that device. |
| **"That passcode didn't work"** | It doesn't match `APP_PASSCODE`. It's case-sensitive. | Retype it. If it's forgotten, set a new value with **Rotate** on `APP_PASSCODE`. |
| **"Set the APP_PASSCODE secret before using the dashboard."** | Supabase is set up but there's no passcode. The site deliberately refuses to open the runs without one. | Add `APP_PASSCODE` (runtime, Secret). |
| **"Couldn't load your runs: Supabase request failed (401)."** | Supabase rejected the key. Wrong key, or the public anon/publishable key was used. | Copy the **secret** key again (see §2) and **Rotate** `SUPABASE_SERVICE_ROLE_KEY`. |
| **"…Supabase request failed (404)."** | The `runs` table doesn't exist, or `SUPABASE_URL` points at the wrong project. | Run `supabase/migrations/*_create_runs.sql` in Supabase's **SQL Editor**, then check the URL. |
| **"…Supabase request failed (400)."** | The table exists but its columns don't match the code, usually an old table from before a schema change. | Compare the migration with the table in Supabase. Write a non-destructive `alter table` (never `drop` once there are real runs). |
| **"Chat is off"** + a grey detail line | `NVIDIA_API_KEY` isn't usable. The detail line says whether it's missing, misnamed (it shows the name it found, in quotes) or empty. | Do what the detail line says. Renaming a secret can drop its value: delete it and add it fresh. Reload after; the check only runs on page load. |
| **"NVIDIA request failed (401)."** | NVIDIA rejected the key. | Copy the key from build.nvidia.com again and **Rotate** `NVIDIA_API_KEY`. |
| **"NVIDIA request failed (404)."** | NVIDIA doesn't know the model name. | Check the model ID in `src/nvidia.js` against build.nvidia.com. Current: `nvidia/nemotron-3.5-lightning-30b-a3b` (confirmed working Oct 29, 2026). |
| **"NVIDIA request failed (unreachable)."** | The Worker couldn't connect to NVIDIA at all. | Usually temporary; try again. Persistent means NVIDIA is down or blocked. |
| **"NVIDIA took too long to answer."** | No reply within 60 seconds. | Try again; the first request is often slow. |

### On Cloudflare and GitHub

| What they see | What it means | Fix |
| --- | --- | --- |
| Build fails at **Cloning**: "error occurred while fetching repository" | The repo is empty, the branch Cloudflare builds (`main`) doesn't exist, or Cloudflare's GitHub app can't see the repo. | Check branches with `mcp__github__list_branches`. Push `main` if missing. Otherwise: GitHub → **Settings → Applications → Installed GitHub Apps → Cloudflare Workers and Pages → Configure** → include the repo. |
| Build fails later (installing or deploying) | A code or config problem. | Ask for the build log (**Copy build log**). Reproduce with `npx wrangler deploy --dry-run`. |
| Secret saved but no new version in **Deployments** | Normal. Cloudflare doesn't always list secret changes there. | Reload the site and check what it reports instead. |
| "I don't see a Deploy button" | Cloudflare's wording varies (Deploy / Save / Add variable). | If the secret shows as **Secret / Value encrypted / Rotate**, it's saved. |

### Pushing from this session

| What you see | What it means | Fix |
| --- | --- | --- |
| `git push` → 403 "Claude doesn't have GitHub access to …" | The owner's GitHub *account* is connected, but the **Claude GitHub App** isn't installed on this repo. Often it was installed for "Only select repositories" before this repo existed. | Owner: GitHub → **Settings → Applications → Installed GitHub Apps → Claude → Configure → Repository access** → add the repo (or https://github.com/apps/claude/installations/select_target). Then push again. Until it works, the commits exist only in this session, so warn them before the session ends. |
| `git push origin <branch>:main` rejected (non-fast-forward) | `main` has commits you don't have. | Fetch, show the owner, ask. Never force-push `main`. |

---

## 2. Secrets

All four live in **Workers & Pages → marathon-training-dashboard → Settings → Variables and Secrets** (the runtime card, not Build), type **Secret**. Names are exact and case-sensitive.

| Name | Where it comes from | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase → **Project Settings → API / Data API** → Project URL | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → **Project Settings → API Keys**: a **secret** key (`sb_secret_…`), or on the **Legacy API keys** tab the `service_role` key (`eyJ…`) | Never the publishable/anon key. `sb_secret_` keys go in the `apikey` header only; legacy keys also need `Authorization: Bearer`. `src/supabase.js` handles both. |
| `APP_PASSCODE` | The owner makes it up | Protects runs and NVIDIA credits. Tell them to save it in a password manager; Cloudflare won't show it again. |
| `NVIDIA_API_KEY` | build.nvidia.com → any model → **Get API Key** (`nvapi-…`) | Optional. Chat returns 503 without it. |

Rules:
- Never have the owner paste a value into chat. Confirm it worked through what the site reports.
- A plain-text "Variable" would be visible in the dashboard. Always use type **Secret**.
- Renaming a secret can leave it without a value. Delete and re-add instead.
- `.dev.vars` (local testing) is gitignored. Delete it when you're done anyway.

---

## 3. GitHub and Cloudflare builds

- The Worker is connected to GitHub with **Workers Builds** and deploys `main`. Build command: none. Deploy command: `npx wrangler deploy`. Root: `/`. No build variables are needed.
- Two separate GitHub apps matter: **Claude** (lets this session push) and **Cloudflare Workers and Pages** (lets Cloudflare clone). Both need access to the repo.
- The first branch pushed to an empty repo becomes GitHub's default. The owner can switch it to `main` under repo **Settings → General → Default branch**.
- A deploy keeps existing secrets, so pushing code never wipes them.

---

## 4. Diagnostics the site gives you

- **`/api/config`** (no passcode needed) returns `{ configured, missing: [names], chat, nvidiaSecretsSeen? }`. It reports names and booleans only, never values. The owner can open `https://marathon-training-dashboard.hannahraquel10.workers.dev/api/config` and read it to you.
- The **setup screen** marks each required secret **✓ FOUND / ✕ MISSING** from that same response.
- The **Chat tab** explains why chat is off (missing, misnamed or empty) from `nvidiaSecretsSeen`.
- Worker errors from Supabase/NVIDIA come back as `"<Service> request failed (<status>)."`. Upstream details are logged on Cloudflare (the Worker's **Observability / Logs**), never shown to the browser.

When a new failure isn't explained by these, extend them the same way: report names, booleans or status codes, never secret values.

---

## 5. Testing locally

The real Supabase and NVIDIA usually aren't reachable from this session, so use the bundled stand-in database:

```bash
printf 'APP_PASSCODE=test-pass\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SERVICE_ROLE_KEY=test-service-key\n' > .dev.vars
(nohup node .claude/skills/ship-it/scripts/mock-supabase.mjs > <scratchpad>/mock.log 2>&1 &)
(nohup npx wrangler dev --port 8787 --ip 127.0.0.1 > <scratchpad>/wrangler.log 2>&1 &)
for i in $(seq 1 40); do curl -s 127.0.0.1:8787/api/config && break; sleep 1; done
```

- Seed runs with `curl -X POST 127.0.0.1:8787/api/runs -H 'Authorization: Bearer test-pass' -H 'Content-Type: application/json' -d '{…}'`.
- Screenshot with Playwright (pre-installed: `require('playwright')`) at `{ width: 390, height: 844 }`. Set `localStorage['mtd.passcode']` first. For Google Fonts to load, launch with `proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' }`. Use `page.clock.setFixedTime(...)` to pin "today" for the countdown and plan weeks.
- To exercise NVIDIA code paths, add `NVIDIA_API_KEY=nvapi-fake` to `.dev.vars` (calls will report "unreachable"), or intercept `/api/chat` with `page.route` to fake a reply.
- **Stopping the servers:** `pkill -f` can match and kill your own shell. Use:
  ```bash
  for p in $(pgrep -f 'mock-supabase.mjs|wrangler-dist/cli.js dev|workerd serve'); do [ "$p" != "$$" ] && kill "$p"; done
  rm -f .dev.vars
  ```
  To confirm they stopped, use `curl -s -m 3 127.0.0.1:8787/api/config || echo down`, not `pgrep`. A `pgrep -f` run in the same shell matches its own command line and falsely reports "still running".
- To test SQL for real: Postgres 16 is installed at `/usr/lib/postgresql/16/bin`. Run it as the `postgres` user with a short data directory like `/tmp/mtd-pg`; long scratchpad paths exceed the socket-path limit.

---

## 6. Quirks of this cloud session

- Outbound access is limited. `*.workers.dev`, `api.cloudflare.com`, Supabase, NVIDIA and docs.api.nvidia.com have all been blocked. You can't check the live site yourself; ask for screenshots.
- The Cloudflare API being blocked means a Cloudflare API token is useless here. Deploys go through GitHub → Workers Builds.
- `git push` goes through a proxy. A 403 is about GitHub App access (see §1), not your credentials.
