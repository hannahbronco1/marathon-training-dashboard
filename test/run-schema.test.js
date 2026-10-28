import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRun } from '../public/js/run-schema.js';

const valid = { run_date: '2026-10-28', distance_km: 10.004, duration_seconds: 3000, run_type: 'tempo', effort: '7', notes: '  windy  ' };

test('accepts and normalises a valid run', () => {
  assert.deepEqual(validateRun(valid).value, {
    run_date: '2026-10-28',
    distance_km: 10,
    duration_seconds: 3000,
    run_type: 'tempo',
    effort: 7,
    notes: 'windy',
  });
});

test('defaults optional fields', () => {
  const { value } = validateRun({ run_date: '2026-10-28', distance_km: 5, duration_seconds: 1500 });
  assert.equal(value.run_type, 'easy');
  assert.equal(value.effort, null);
  assert.equal(value.notes, null);
});

test('drops unknown fields', () => {
  const { value } = validateRun({ ...valid, id: 'x', created_at: 'y', admin: true });
  assert.deepEqual(Object.keys(value).sort(), ['distance_km', 'duration_seconds', 'effort', 'notes', 'run_date', 'run_type']);
});

test('rejects bad input field by field', () => {
  const { errors } = validateRun({
    run_date: '2026-02-30',
    distance_km: 0,
    duration_seconds: 12.5,
    run_type: 'sprint',
    effort: 11,
    notes: 'x'.repeat(2001),
  });
  assert.deepEqual(Object.keys(errors).sort(), ['distance_km', 'duration_seconds', 'effort', 'notes', 'run_date', 'run_type']);
  assert.ok(validateRun(null).errors);
});
