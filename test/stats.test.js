import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/js/stats.js';

test('plan weeks run Monday to Sunday from the week containing the start date', () => {
  assert.equal(S.planWeekFor('2026-10-18'), null); // Sunday before the plan
  assert.equal(S.planWeekFor('2026-10-19'), 1); // Monday of Week 1
  assert.equal(S.planWeekFor('2026-10-20'), 1); // plan start (Tuesday)
  assert.equal(S.planWeekFor('2026-10-25'), 1); // Sunday ends Week 1
  assert.equal(S.planWeekFor('2026-10-26'), 2);
  assert.equal(S.planWeekFor('2027-03-07'), 20); // race day
  assert.equal(S.planWeekStart(1), '2026-10-19');
  assert.equal(S.planWeekStart(20), '2027-03-01');
});

test('nextPlanDay counts earlier runs that week', () => {
  const runs = [
    { id: 'a', plan_week: 2, run_date: '2026-10-27' },
    { id: 'b', plan_week: 2, run_date: '2026-10-29' },
    { id: 'c', plan_week: 1, run_date: '2026-10-21' },
  ];
  assert.equal(S.nextPlanDay(runs, 2, '2026-10-30'), 3);
  assert.equal(S.nextPlanDay(runs, 2, '2026-10-28'), 2);
  assert.equal(S.nextPlanDay(runs, 3, '2026-11-02'), 1);
  assert.equal(S.nextPlanDay(runs, 2, '2026-10-30', 'b'), 2); // editing b
});

test('duration helpers', () => {
  assert.equal(S.toSeconds('1', '05', '30'), 3930);
  assert.equal(S.toSeconds('', '45', ''), 2700);
  assert.ok(Number.isNaN(S.toSeconds('0', '60', '0')));
  assert.ok(Number.isNaN(S.toSeconds('0', '30', '75')));
  assert.ok(Number.isNaN(S.toSeconds('0', '30.5', '0')));
  assert.equal(S.formatDuration(3930), '1:05:30');
  assert.equal(S.formatDuration(2700), '0:45:00');
  assert.equal(S.formatHours(5 * 3600 + 20 * 60), '5h 20m');
});

test('pace is minutes per mile', () => {
  assert.equal(S.formatPace(S.paceSeconds(3600, 6)), '10:00/mi');
  assert.equal(S.formatPace(S.paceSeconds(2730, 5.25), false), '8:40');
  assert.equal(S.formatPace(null), '–');
});

test('summarizeWeeks groups by stored Week # and fills gaps', () => {
  const runs = [
    { plan_week: 1, miles: 4, duration_seconds: 2400 },
    { plan_week: 3, miles: 6, duration_seconds: 3600 },
    { plan_week: 3, miles: 10.5, duration_seconds: 6300 },
  ];
  const weeks = S.summarizeWeeks(runs, 3);
  assert.deepEqual(weeks.map((w) => w.miles), [4, 0, 16.5]);
  assert.equal(weeks[2].runCount, 2);
  assert.equal(weeks[2].longestMiles, 10.5);
});

test('currentPlanWeek covers runs logged ahead', () => {
  assert.equal(S.currentPlanWeek([], '2026-10-28'), 2);
  assert.equal(S.currentPlanWeek([{ plan_week: 4 }], '2026-10-28'), 4);
  assert.equal(S.currentPlanWeek([], '2026-10-01'), 1);
});

test('percentChange handles a missing baseline', () => {
  assert.equal(S.percentChange(11, 10), 0.1);
  assert.equal(S.percentChange(5, 0), null);
});

test('race countdown and bib formatting', () => {
  assert.deepEqual(S.raceCountdown('2026-10-28'), { days: 130, week: 2, totalWeeks: 20 });
  assert.deepEqual(S.raceCountdown('2027-03-07'), { days: 0, week: 20, totalWeeks: 20 });
  assert.equal(S.raceCountdown('2026-10-01').week, null);
  assert.equal(S.formatBibDate('2027-03-07'), 'SUN 03.07.27');
  assert.equal(S.weekCode(4), 'W04');
  assert.equal(S.shortMiles(10.7), '10.7');
  assert.equal(S.shortMiles('6.00'), '6');
  assert.equal(S.shortMiles(3.25), '3.25');
});

test('planTotals adds up every run and finds the longest', () => {
  const runs = [
    { run_date: '2026-10-20', miles: 3.2, duration_seconds: 2304 },
    { run_date: '2026-10-25', miles: '10.7', duration_seconds: 7335 },
    { run_date: '2026-10-27', miles: 10.7, duration_seconds: 7000 },
  ];
  const totals = S.planTotals(runs);
  assert.equal(Math.round(totals.miles * 100) / 100, 24.6);
  assert.equal(totals.durationSeconds, 16639);
  assert.equal(totals.runCount, 3);
  assert.equal(totals.longest.run_date, '2026-10-25'); // ties go to the first time you ran it
  assert.deepEqual(S.planTotals([]), { miles: 0, durationSeconds: 0, runCount: 0, longest: null });
});

test('cumulativeMiles builds a running total by date', () => {
  const runs = [
    { run_date: '2026-10-25', miles: 10.7 },
    { run_date: '2026-10-20', miles: 3.2 },
    { run_date: '2026-10-25', miles: 1.1 },
    { run_date: '2026-10-22', miles: '2.9' },
  ];
  assert.deepEqual(S.cumulativeMiles(runs), [
    { date: '2026-10-20', dayMiles: 3.2, total: 3.2 },
    { date: '2026-10-22', dayMiles: 2.9, total: 6.1 },
    { date: '2026-10-25', dayMiles: 11.8, total: 17.9 },
  ]);
  assert.deepEqual(S.cumulativeMiles([]), []);
});
