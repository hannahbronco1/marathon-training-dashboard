---
name: what-changed
description: Writes a friendly, code-free summary of recent updates to the marathon training dashboard website, read from the project's git history, so the site owner can see at a glance what's new, what looks different, what got fixed, and anything they need to do. Use this whenever the user asks what changed, what's new, what was built or done recently, to be caught up, for a recap or changelog of the site or project, or says something like "remind me what we did this week" or "what's different since last time", even if they don't say "summary". Not for summaries of the user's running itself (miles, weekly training) and not for developer-level diffs or code review.
---

# What changed?

The owner of this site is a runner, not a developer. They want to know what their website can do now that it couldn't before, told the way a friend who helped build it would tell them: plainly, warmly, and briefly. The git history is the source of truth; your job is to translate it.

## 1. Pick the time window

- If the user names a window ("this week", "since Tuesday", "since the redesign", "the last 3 updates"), use it.
- Otherwise, default to the **last 7 days**. Say which window you used in the opening line so they can ask for a different one.
- If nothing changed in that window, say so in one friendly line and mention when the most recent update was.

## 2. Read what actually happened

Read the history of `main`, because that's what the live site is built from:

```bash
git fetch origin main --quiet 2>/dev/null
git log origin/main --since="7 days ago" --format='%h %ad%n%s%n%b%n---' --date=format:'%a %b %d'
```

(Fall back to the local branch if `origin/main` isn't available.) Commit messages here are usually descriptive, so start from them. When a message is vague or you're unsure what a change means for the person using the site, look at what it touched (`git show --stat <hash>`, then the diff) rather than guessing. Only describe things that are really in the history. A confident-sounding summary of something that didn't happen is worse than a short one.

## 3. Translate into what they'll notice

Describe each change by what the user sees or can do, not how it was built:

| Instead of | Say |
| --- | --- |
| Added POST /api/chat endpoint | The site can now talk to NVIDIA's AI |
| Restyled CSS tokens, Space Grotesk + JetBrains Mono | The whole site has the dark race-bib look, with lime accents and new fonts |
| /api/config lists missing secrets | The setup screen now shows exactly which Cloudflare secrets are missing |
| Support sb_secret_ keys | Supabase's newer style of secret key works now |

Leave out file names, function names, code, and words like commit, branch, endpoint, API, migration, or refactor. If a technical idea is unavoidable, explain it in a few plain words. Changes that only touch tests, tooling, or internal cleanup can be folded into a single "behind the scenes" line, or skipped if they don't matter to the user.

Group related commits into one item. Five commits that together added the Chat tab are one item: "A Chat tab where you can talk to NVIDIA's AI."

## 4. Surface anything they need to do

This is the most useful part, so don't bury it. Look for changes that need action from the owner: a new secret to add in Cloudflare, SQL to run in Supabase, a setting to change, something to test on their phone. Put these in their own short section with the exact name or step. If there's nothing to do, leave the section out.

## 5. Write it in this shape

```
**What changed** (Wed Oct 28 – Thu Oct 29)

One or two sentences giving the big picture, e.g. "Big couple of days: your site got its race-bib look and a new Chat tab."

**New**
- …

**Looks different**
- …

**Fixed**
- …

**For you to do**
- …
```

Use only the sections that have something in them. Keep each bullet to one line where you can, and the whole summary short enough to read on a phone: usually under 15 bullets, often far fewer. End with an offer that fits, like asking whether they want more detail on any item, but only one line.

## Tone

Friendly and practical, like a running buddy who also builds websites: a little upbeat, never gushing, no hype words. Don't add training advice, coaching, or commentary on their running, food, or notes. This summary is about the website.
