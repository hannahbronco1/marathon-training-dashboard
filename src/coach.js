// Training feedback from an LLM on NVIDIA's API catalog (build.nvidia.com),
// which exposes an OpenAI-compatible chat completions endpoint.

import { UpstreamError } from './supabase.js';
import { formatDuration, formatPace, paceSeconds, toUnit, UNITS } from '../public/js/stats.js';

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';

const SYSTEM_PROMPT = `You are an experienced, encouraging marathon coach.
You are given a runner's recent training log. Reply with:
1. A two-sentence read on how training is going.
2. Up to three specific, practical suggestions for the next week.
Keep it under 180 words. Use plain text, no markdown headings or tables.
Flag weekly distance jumps of more than about 10% and signs of overtraining.
You are not a doctor: for pain or injury, suggest seeing a professional.`;

export function isCoachConfigured(env) {
  return Boolean(env.NVIDIA_API_KEY);
}

function describeRun(run, unit) {
  const parts = [
    run.run_date,
    run.run_type,
    `${toUnit(run.distance_km, unit).toFixed(1)} ${UNITS[unit].label}`,
    formatDuration(run.duration_seconds),
    `pace ${formatPace(paceSeconds(run.duration_seconds, run.distance_km, unit), unit)}`,
  ];
  if (run.effort) parts.push(`effort ${run.effort}/10`);
  if (run.notes) parts.push(`notes: ${run.notes.replace(/\s+/g, ' ')}`);
  return `- ${parts.join(' · ')}`;
}

export function buildCoachPrompt(runs, unit, question) {
  const log = runs.length ? runs.map((run) => describeRun(run, unit)).join('\n') : '(no runs logged yet)';
  const ask = question ? `\n\nThe runner asks: ${question}` : '';
  return `Training log, newest first (distances in ${unit === 'mi' ? 'miles' : 'kilometres'}):\n${log}${ask}`;
}

export async function getCoachReply(env, runs, unit, question) {
  const res = await fetch(NVIDIA_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: env.NVIDIA_MODEL || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildCoachPrompt(runs, unit, question) },
      ],
      temperature: 0.4,
      max_tokens: 500,
    }),
  });
  if (!res.ok) throw new UpstreamError('NVIDIA', res.status, await res.text());
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}
