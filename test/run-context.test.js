import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunLog, runLogSystemMessage, RUN_LOG_INSTRUCTIONS } from '../src/run-context.js';

const runs = [
  { run_date: '2026-10-20', plan_week: 1, plan_day: 1, miles: 3.2, duration_seconds: 2304, temperature_f: 76, conditions: 'sunny', location: 'inside', run_type: 'easy', food_pre: 'Water', food_post: 'protein shake', notes: 'Broke into two runs because of the treadmills' },
  { run_date: '2026-10-22', plan_week: 1, plan_day: 2, miles: '2.90', duration_seconds: 2042, temperature_f: '80.0', conditions: 'humid', location: 'inside', run_type: 'tempo', food_during: 'Clif Energy Chews', notes: 'Tempo Run, made progress' },
  { run_date: '2026-10-25', plan_week: 1, plan_day: 3, miles: 10.7, duration_seconds: 7335, temperature_f: 70, conditions: null, location: 'inside', run_type: 'long', food_during: 'GU gels every 25 minutes', notes: 'Long run; goal was 2 hours' },
];

test('run log has totals, weeks and every run', () => {
  const log = buildRunLog(runs, new Map([[1, 15]]), '2026-10-30');
  assert.match(log, /Today: 2026-10-30 \(Week 2 of 20\)/);
  assert.match(log, /Plan totals: 16\.80 mi over 3 runs, 3h 15m, average pace 11:35\/mi\. Longest run: 10\.70 mi on 2026-10-25\./);
  assert.match(log, /W01 \| Oct 19 – Oct 25 \| 16\.80 mi \| 3 runs \| 3h 15m \| 11:35\/mi \| 10\.70 mi \| target 15 mi \(112%\)/);
  assert.match(log, /W02 \| Oct 26 – Nov 1 \| 0\.00 mi \| 0 runs/);
  assert.match(log, /2026-10-25 Sun \| W01·D3 \| long \| 10\.70 mi \| 2:02:15 \| 11:26\/mi \| 70°F \| - \| inside/);
  assert.match(log, /2026-10-22 Thu \| W01·D2 \| tempo \| 2\.90 mi \| 0:34:02 \| 11:44\/mi \| 80°F \| humid \| inside/);
});

test('food and notes never reach the model', () => {
  const log = buildRunLog(runs, new Map(), '2026-10-30');
  for (const text of ['Water', 'protein shake', 'Clif', 'GU gels', 'treadmills', 'Tempo Run', 'goal was']) {
    assert.doesNotMatch(log, new RegExp(text), text);
  }
});

test('instructions keep the chat within the project boundaries', () => {
  assert.match(RUN_LOG_INSTRUCTIONS, /only the data given/);
  assert.match(RUN_LOG_INSTRUCTIONS, /not a coach, doctor or dietitian/);
  assert.match(RUN_LOG_INSTRUCTIONS, /doctor or physical therapist/);
  assert.match(RUN_LOG_INSTRUCTIONS, /food, drink and notes are not shared/);
  const message = runLogSystemMessage([], new Map(), '2026-10-30');
  assert.equal(message.role, 'system');
  assert.match(message.content, /No runs have been logged yet\./);
});
