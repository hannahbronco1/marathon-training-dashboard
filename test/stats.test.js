import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/js/stats.js';

test('weekStart returns the Monday of the week', () => {
  assert.equal(S.weekStart('2026-10-28'), '2026-10-26'); // Wednesday
  assert.equal(S.weekStart('2026-10-26'), '2026-10-26'); // Monday
  assert.equal(S.weekStart('2026-11-01'), '2026-10-26'); // Sunday
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(S.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(S.addDays('2026-03-01', -1), '2026-02-28');
});

test('duration helpers round-trip', () => {
  assert.equal(S.toSeconds('1', '5', '30'), 3930);
  assert.equal(S.toSeconds('', '45', ''), 2700);
  assert.ok(Number.isNaN(S.toSeconds('-1', '0', '0')));
  assert.equal(S.formatDuration(3930), '1:05:30');
  assert.equal(S.formatDuration(2700), '45:00');
  assert.equal(S.formatHours(5 * 3600 + 20 * 60), '5h 20m');
  assert.equal(S.formatHours(40 * 60), '40m');
});

test('pace and distance convert between km and miles', () => {
  assert.equal(S.formatPace(S.paceSeconds(1800, 6, 'km'), 'km'), '5:00 /km');
  assert.equal(S.formatPace(S.paceSeconds(3600, S.KM_PER_MILE * 8, 'mi'), 'mi'), '7:30 /mi');
  assert.equal(S.formatDistance(42.195, 'mi'), '26.2 mi');
  assert.ok(Math.abs(S.fromUnit(26.2, 'mi') - 42.165) < 0.01);
  assert.equal(S.formatPace(null, 'km'), '–');
});

test('recentWeeks fills empty weeks and totals runs', () => {
  const runs = [
    { run_date: '2026-10-27', distance_km: 10, duration_seconds: 3000 },
    { run_date: '2026-10-28', distance_km: 20, duration_seconds: 6600 },
    { run_date: '2026-10-13', distance_km: 8, duration_seconds: 2400 },
    { run_date: '2026-01-01', distance_km: 5, duration_seconds: 1500 }, // outside range
  ];
  const weeks = S.recentWeeks(runs, 3, '2026-10-29');
  assert.deepEqual(weeks.map((w) => w.weekStart), ['2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(weeks.map((w) => w.distanceKm), [8, 0, 30]);
  assert.equal(weeks[2].runCount, 2);
  assert.equal(weeks[2].longestKm, 20);
  assert.equal(weeks[2].durationSeconds, 9600);
});

test('allWeeks spans first run to the current week', () => {
  const runs = [{ run_date: '2026-10-05', distance_km: 5, duration_seconds: 1500 }];
  const weeks = S.allWeeks(runs, '2026-10-28');
  assert.equal(weeks.length, 4);
  assert.equal(weeks[0].weekStart, '2026-10-05');
  assert.equal(weeks.at(-1).weekStart, '2026-10-26');
  assert.deepEqual(S.allWeeks([], '2026-10-28'), []);
});

test('percentChange handles a missing baseline', () => {
  assert.equal(S.percentChange(11, 10), 0.1);
  assert.equal(S.percentChange(5, 0), null);
});

test('sortRunsDesc orders by date then creation time', () => {
  const sorted = S.sortRunsDesc([
    { id: 'a', run_date: '2026-10-01', created_at: '2026-10-01T08:00:00Z' },
    { id: 'b', run_date: '2026-10-02', created_at: '2026-10-02T08:00:00Z' },
    { id: 'c', run_date: '2026-10-01', created_at: '2026-10-01T18:00:00Z' },
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ['b', 'c', 'a']);
});
