// Chat requests to NVIDIA's hosted models (build.nvidia.com), which use an
// OpenAI-compatible chat completions API. Runs server-side in the Worker so
// the NVIDIA_API_KEY secret never reaches the browser.

import { UpstreamError } from './supabase.js';

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

const ROLES = new Set(['system', 'user', 'assistant']);
const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 16000;
const DEFAULT_MAX_TOKENS = 1024;
const MAX_MAX_TOKENS = 4096;
const TIMEOUT_MS = 60_000;

export function isNvidiaConfigured(env) {
  return Boolean(String(env.NVIDIA_API_KEY ?? '').trim());
}

// Accepts { prompt: "..." } or { messages: [{ role, content }, ...] } plus an
// optional max_tokens. Returns { value } or { error } with a message.
export function parseChatRequest(body) {
  const src = body && typeof body === 'object' ? body : {};
  const messages = typeof src.prompt === 'string' ? [{ role: 'user', content: src.prompt }] : src.messages;

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return { error: `Send { "prompt": "..." } or 1–${MAX_MESSAGES} messages as { "messages": [...] }.` };
  }
  for (const m of messages) {
    if (!m || !ROLES.has(m.role) || typeof m.content !== 'string' || !m.content.trim()) {
      return { error: 'Each message needs a role (system, user or assistant) and some text.' };
    }
    if (m.content.length > MAX_CONTENT_LENGTH) {
      return { error: `Keep each message under ${MAX_CONTENT_LENGTH} characters.` };
    }
  }

  let maxTokens = DEFAULT_MAX_TOKENS;
  if (src.max_tokens !== undefined) {
    maxTokens = Number(src.max_tokens);
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_MAX_TOKENS) {
      return { error: `max_tokens must be a whole number from 1 to ${MAX_MAX_TOKENS}.` };
    }
  }

  return {
    value: {
      messages: messages.map(({ role, content }) => ({ role, content })),
      maxTokens,
      includeRuns: src.include_runs === true,
    },
  };
}

// Reasoning models can put their thinking inside <think>…</think>; keep only
// the answer.
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export class TimeoutError extends Error {}

export async function chat(env, { messages, maxTokens }) {
  let res;
  try {
    res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY.trim()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: NVIDIA_MODEL, messages, max_tokens: maxTokens, stream: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new TimeoutError('NVIDIA took too long to answer.');
    throw new UpstreamError('NVIDIA', 'unreachable', err.message);
  }
  if (!res.ok) throw new UpstreamError('NVIDIA', res.status, await res.text());

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    reply: stripThinking(choice?.message?.content ?? ''),
    finish_reason: choice?.finish_reason ?? null,
    model: data.model ?? NVIDIA_MODEL,
    usage: data.usage ?? null,
  };
}
