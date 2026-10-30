import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../public/js/backup.js';

const runs = [
  { id: 'a', run_date: '2026-10-20', plan_week: 1, plan_day: 1, miles: 3.2, duration_seconds: 2304, temperature_f: 76, conditions: 'sunny', location: 'inside', run_type: 'easy', food_pre: 'Water', food_during: 'Water', food_post: 'protein shake', notes: 'Broke into two runs because of the treadmills not working; felt productive' },
  { id: 'b', run_date: '2026-10-25', plan_week: 1, plan_day: 3, miles: '10.70', duration_seconds: 7335, temperature_f: '70.0', conditions: null, location: 'inside', run_type: 'long', food_pre: 'Nothing', food_during: 'Clif Energy Chews, GU gels every 25 minutes, C4 energy drink, water', food_post: '  coffee "drink",\neggs  ', notes: 'Line one\n\nLine "two", with commas' },
];

test('CSV export has a header row and readable values', () => {
  const csv = B.runsToCSV(runs);
  assert.ok(csv.startsWith('﻿run_date,plan_week,plan_day,miles,duration,pace,'));
  assert.match(csv, /\r\n2026-10-20,1,1,3\.20,0:38:24,12:00,76,sunny,inside,easy,Water,Water,protein shake,/);
  assert.match(csv, /"Clif Energy Chews, GU gels every 25 minutes, C4 energy drink, water"/);
});

test('CSV round trip keeps food and notes exactly as written', () => {
  const plan = B.readImportFile('runs.csv', B.runsToCSV(runs), []);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.toAdd.length, 2);
  const long = plan.toAdd.find((r) => r.run_date === '2026-10-25');
  assert.equal(long.food_post, '  coffee "drink",\neggs  ');
  assert.equal(long.notes, 'Line one\n\nLine "two", with commas');
  assert.equal(long.food_during, runs[1].food_during);
  assert.equal(long.duration_seconds, 7335);
  assert.equal(long.miles, 10.7);
  assert.equal(long.conditions, null);
});

test('JSON backup round trip includes targets', () => {
  const json = B.backupJSON(runs, new Map([[2, 20], [1, 15]]), '2026-10-30T00:00:00.000Z');
  const data = JSON.parse(json);
  assert.equal(data.version, 1);
  assert.equal(data.runs.length, 2);
  assert.equal(data.runs[0].id, undefined);
  assert.deepEqual(data.targets, [{ plan_week: 1, target_miles: 15 }, { plan_week: 2, target_miles: 20 }]);
  const plan = B.readImportFile('backup.json', json, []);
  assert.equal(plan.toAdd.length, 2);
  assert.deepEqual(plan.targets, [{ plan_week: 1, target_miles: 15 }, { plan_week: 2, target_miles: 20 }]);
  assert.equal(plan.toAdd[1].notes, runs[1].notes);
});

test('runs already in the log are skipped, including repeats within the file', () => {
  const csv = B.runsToCSV([...runs, runs[0]]);
  const plan = B.readImportFile('runs.csv', csv, [runs[1]]);
  assert.equal(plan.toAdd.length, 1);
  assert.equal(plan.toAdd[0].run_date, '2026-10-20');
  assert.equal(plan.duplicates, 2);
});

test('a hand-made spreadsheet with other headers and blanks works', () => {
  const csv = [
    'Date,Distance,Time,Temperature,Where,Type,Notes',
    '2026-10-27,4 mi,46:00,68°F,Outside,Easy,  felt good  ',
    '2026-10-29,5.5,0:51:20,64,inside,TEMPO,',
  ].join('\n');
  const plan = B.readImportFile('my runs.csv', csv, [{ run_date: '2026-10-26', plan_week: 2, plan_day: 1 }]);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(
    plan.toAdd.map((r) => [r.run_date, r.plan_week, r.plan_day, r.miles, r.duration_seconds, r.temperature_f, r.location, r.run_type, r.notes]),
    [
      ['2026-10-27', 2, 2, 4, 2760, 68, 'outside', 'easy', '  felt good  '],
      ['2026-10-29', 2, 3, 5.5, 3080, 64, 'inside', 'tempo', null],
    ],
  );
});

test('problems are reported by row and nothing invalid is added', () => {
  const csv = ['run_date,miles,duration,temperature_f,location,run_type', '2026-10-27,0,0:30:00,60,outside,easy', '2026-10-28,3,0:75:00,60,gym,easy', '2026-10-29,3,0:30:00,60,outside,easy'].join('\n');
  const plan = B.readImportFile('runs.csv', csv, []);
  assert.equal(plan.toAdd.length, 1);
  assert.equal(plan.problems.length, 2);
  assert.match(plan.problems[0], /^Row 2: Miles must be more than 0\./);
  assert.match(plan.problems[1], /^Row 3: .*duration.*inside or outside/i);
});

test('bad files explain themselves', () => {
  assert.match(B.readImportFile('x.json', '{oops', []).problems[0], /valid JSON/);
  assert.match(B.readImportFile('x.json', '{"hello":1}', []).problems[0], /No runs/);
  assert.match(B.readImportFile('x.csv', 'miles,duration\n3,0:30:00', []).problems[0], /run_date/);
  assert.match(B.readImportFile('x.csv', '', []).problems[0], /empty/);
});

test('durations in different shapes', () => {
  assert.equal(B.parseDuration('1:02:03'), 3723);
  assert.equal(B.parseDuration('02:02:15'), 7335);
  assert.equal(B.parseDuration('38:24'), 2304);
  assert.equal(B.parseDuration('2304'), 2304);
  assert.ok(Number.isNaN(B.parseDuration('abc')));
  assert.ok(Number.isNaN(B.parseDuration('1:75:00')));
});

test('CSV parser handles quotes, CRLF and a template with no rows', () => {
  assert.deepEqual(B.parseCSVText('a,b\r\n"x, y","he said ""hi"""\r\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(B.readImportFile('t.csv', B.csvTemplate(), []).toAdd, []);
  assert.equal(B.exportFileName('csv', '2026-10-30'), 'marathon-runs-2026-10-30.csv');
});
