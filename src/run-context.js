// Builds what the chat model sees when "Include my run log" is on: a short
// set of instructions plus a plain-text copy of the run log with totals
// worked out in advance (models are unreliable at adding up numbers).
//
// Food and notes are deliberately left out: under the project boundaries
// they're a journal shown exactly as written, never analysed.

import { PLAN } from '../public/js/plan.js';
import { runTypeLabel, locationLabel } from '../public/js/run-schema.js';
import * as S from '../public/js/stats.js';

const MAX_RUNS = 400;

export const RUN_LOG_INSTRUCTIONS = `You are the chat on a runner's personal marathon training dashboard. Below is their run log.

- Answer questions about the log factually, using only the data given. Be brief and friendly, in plain text.
- Use the totals provided instead of adding numbers up yourself. If you do calculate something, show the numbers you used.
- If the log doesn't contain the answer, say so. Don't guess or invent runs.
- You are not a coach, doctor or dietitian. Don't give training advice, suggest changes to their plan, recommend paces or mileage, or predict race performance. If asked, say in one sentence that you can only report what's in their log.
- If they mention pain, injury or symptoms, don't assess them: in one or two warm sentences suggest a doctor or physical therapist, then offer to keep helping with the log.
- Their food, drink and notes are not shared with you. If asked about them, say so.`;

const dash = (v) => (v === null || v === undefined || v === '' ? '-' : v);

// The run log as text. `targets` is a Map of plan week -> target miles.
export function buildRunLog(runs, targets = new Map(), today = S.todayISO()) {
  const { days, week: todayWeek, totalWeeks } = S.raceCountdown(today);
  const lines = [
    `Today: ${today} (${todayWeek ? `Week ${todayWeek} of ${totalWeeks}` : 'before Week 1'}).`,
    `Race: ${PLAN.raceName} on ${PLAN.raceDate} (end of Week ${totalWeeks}), ${days >= 0 ? `${days} days away` : `${-days} days ago`}.`,
    `Plan weeks run Monday to Sunday; Week 1 is ${S.planWeekStart(1)} to ${S.addDays(S.planWeekStart(1), 6)}.`,
    'Distances are miles, paces are minutes per mile, temperatures are °F.',
    '',
  ];

  if (!runs.length) {
    lines.push('No runs have been logged yet.');
    return lines.join('\n');
  }

  const totals = S.planTotals(runs);
  lines.push(
    `Plan totals: ${totals.miles.toFixed(2)} mi over ${totals.runCount} runs, ${S.formatHours(totals.durationSeconds)}, ` +
      `average pace ${S.formatPace(S.paceSeconds(totals.durationSeconds, totals.miles))}. ` +
      `Longest run: ${Number(totals.longest.miles).toFixed(2)} mi on ${totals.longest.run_date}.`,
    '',
    'Weekly totals (week | dates | miles | runs | time | avg pace | longest | target):',
  );
  for (const w of S.summarizeWeeks(runs, S.currentPlanWeek(runs, today))) {
    const target = targets.get(w.week);
    const targetText = target ? `target ${target} mi (${Math.round((w.miles / target) * 100)}%)` : 'no target';
    lines.push(
      [
        S.weekCode(w.week),
        S.formatWeekRange(w.week),
        `${w.miles.toFixed(2)} mi`,
        `${w.runCount} runs`,
        S.formatHours(w.durationSeconds),
        w.runCount ? S.formatPace(S.paceSeconds(w.durationSeconds, w.miles)) : '-',
        w.runCount ? `${w.longestMiles.toFixed(2)} mi` : '-',
        targetText,
      ].join(' | '),
    );
  }

  const shown = S.sortRunsDesc(runs).slice(0, MAX_RUNS);
  lines.push('', `Runs, newest first (date | week·day | type | miles | time | pace | temp | conditions | where):`);
  for (const r of shown) {
    lines.push(
      [
        `${r.run_date} ${S.formatLongDate(r.run_date).split(',')[0]}`,
        `W${String(r.plan_week).padStart(2, '0')}·D${r.plan_day}`,
        runTypeLabel(r.run_type).toLowerCase(),
        `${Number(r.miles).toFixed(2)} mi`,
        S.formatDuration(r.duration_seconds),
        S.formatPace(S.paceSeconds(r.duration_seconds, Number(r.miles))),
        `${Number(r.temperature_f)}°F`,
        dash(r.conditions),
        locationLabel(r.location).toLowerCase(),
      ].join(' | '),
    );
  }
  if (runs.length > shown.length) lines.push(`(${runs.length - shown.length} older runs not shown.)`);
  return lines.join('\n');
}

export function runLogSystemMessage(runs, targets, today) {
  return { role: 'system', content: `${RUN_LOG_INSTRUCTIONS}\n\n--- RUN LOG ---\n${buildRunLog(runs, targets, today)}` };
}
