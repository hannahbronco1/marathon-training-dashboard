import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks } from '../public/js/charts.js';

test('niceTicks picks round numbers', () => {
  assert.deepEqual(niceTicks(0, 16.8), [0, 5, 10, 15, 20]);
});

test('niceTicks uses clock-friendly steps for times', () => {
  assert.deepEqual(niceTicks(540, 720, 4, true), [540, 600, 660, 720]); // 9:00 – 12:00
  assert.deepEqual(niceTicks(690, 695, 4, true), [690, 705]); // never under 15 seconds
});
