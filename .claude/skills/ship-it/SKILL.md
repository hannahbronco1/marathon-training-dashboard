---
name: ship-it
description: Ships changes to the marathon training dashboard safely and fixes the live site when it breaks. Covers running the tests, checking the Cloudflare build, pushing to the working branch and to main (which Cloudflare deploys), telling the site owner what to check afterwards, and troubleshooting Cloudflare secrets, Workers Builds, GitHub access, Supabase and NVIDIA errors. Use this whenever you are about to commit or push, when the user says ship it, deploy, publish, push, or make it live, and whenever they report the live site not working, a failed Cloudflare build, a "Connect your database" or "Chat is off" screen, a missing or misnamed secret, or an error code like 401, 404, 502 or 503, even if they don't name this skill.
---

# Ship it

Two jobs: getting a change live without breaking the site, and getting the site working again when it isn't. The site owner is a runner, not a developer, so every step they have to do should be one clear click path, and every result you need from them should be a screenshot or a short line of text.

How this site is wired (details in `CLAUDE.md`):

- Cloudflare **Workers Builds** watches the GitHub repo and deploys **`main`**. Build command: none. Deploy command: `npx wrangler deploy`. Root: `/`.
- The Worker serves `public/` and handles `/api/*`. It needs runtime secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSCODE`, and optionally `NVIDIA_API_KEY`.
- Claude works on its own `claude/...` branch and pushes every finished change to both that branch and `main`. The user approved pushing to `main` so changes deploy.

## Shipping a change

Do these in order, and stop to fix anything that fails. A push that breaks the live site costs the owner far more time than catching it here.

1. **Run the tests**: `npm test`. All must pass.
2. **Check that it builds** the way Cloudflare will build it:
   `npx wrangler deploy --dry-run --outdir <scratchpad>/dist` and look for "Total Upload" with no errors.
3. **If anything visible changed, look at it.** Run it locally and screenshot it at phone size (390px wide). See "Testing locally" in `references/troubleshooting.md`. The validator and tests don't catch layout problems; your eyes do.
4. **Check for secrets.** Make sure nothing secret is staged: no `.dev.vars`, no keys in code. `git status --short` should show only the files you meant to change.
5. **Commit** with a message that says what changed for the user and why. Follow the commit attribution rules this session gives you.
6. **Push to the working branch, then to `main`:**
   ```bash
   git push -u origin <working-branch>
   git push origin <working-branch>:main
   ```
   The second push must be a fast-forward. If it's rejected because `main` has commits you don't have, someone changed `main` directly: fetch it, show the user what's there, and ask before merging. Never force-push `main`. If a push fails on a network error, retry up to 4 times, waiting 2, 4, 8 and then 16 seconds.
7. **Confirm on GitHub** that both branches point at the new commit (`mcp__github__list_branches`).
8. **Tell the owner what to do next**, briefly:
   - Cloudflare takes a minute or two to build. Then they should reload the site.
   - Exactly what to look at to see the change.
   - Any action the change needs from them, as exact click paths: a new secret, SQL to run in Supabase (give the full SQL in a copyable block), or a setting. If there's nothing to do, say so.

Never ask the owner to paste a key, passcode or secret value into the chat. Have them put it straight into Cloudflare or Supabase, and give them a way to confirm it worked that doesn't reveal the value.

## When the live site isn't working

This session's network usually can't reach the live `*.workers.dev` site, Cloudflare's API, Supabase or NVIDIA. So you can't look yourself. Work from what the owner sees:

1. Ask for a screenshot of the screen, or the exact error text.
2. Match it against **"Symptoms and fixes"** in `references/troubleshooting.md`. Most problems we've hit are there, with the fix that actually worked.
3. Give **one** next step with an exact click path, and say what they should see if it worked and what to send back if it didn't. Don't give a list of five guesses.
4. If the screen doesn't explain the problem well enough, improve what the site reports, as was done for the setup screen and the Chat tab. Report names, booleans or status codes, never secret values. Then ship that, and ask them to reload.

When something new goes wrong and you find the fix, add it to `references/troubleshooting.md` so the next session doesn't relearn it the hard way.
