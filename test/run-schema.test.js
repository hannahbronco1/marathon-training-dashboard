import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRun } from '../public/js/run-schema.js';

const valid = {
  run_date: '2026-10-27',
  plan_week: '2',
  plan_day: '1',
  miles: '6.255',
  duration_seconds: 3300,
  temperature_f: '61.5',
  conditions: ' sunny ',
  location: 'outside',
  run_type: 'easy',
  food_pre: '  toast + coffee  ',
  food_during: '',
  food_post: 'Chocolate milk\nbanana',
  notes: '  Felt strong.\n\nHills at mile 4  ',
};

test('accepts and normalises a valid run', () => {
  assert.deepEqual(validateRun(valid).value, {
    run_date: '2026-10-27',
    plan_week: 2,
    plan_day: 1,
    miles: 6.26,
    duration_seconds: 3300,
    temperature_f: 61.5,
    conditions: 'sunny',
    location: 'outside',
    run_type: 'easy',
    food_pre: '  toast + coffee  ',
    food_during: null,
    food_post: 'Chocolate milk\nbanana',
    notes: '  Felt strong.\n\nHills at mile 4  ',
  });
});

test('stores food and notes exactly as written', () => {
  const { value } = validateRun(valid);
  assert.equal(value.food_pre, valid.food_pre);
  assert.equal(value.notes, valid.notes);
});

test('drops unknown fields', () => {
  const { value } = validateRun({ ...valid, id: 'x', calories: 500 });
  assert.equal(value.id, undefined);
  assert.equal(value.calories, undefined);
});

test('miles must be more than 0', () => {
  for (const miles of [0, -1, '', 'abc', 201]) {
    assert.ok(validateRun({ ...valid, miles }).errors.miles, `miles=${miles}`);
  }
});

test('week and day must be whole numbers', () => {
  for (const plan_week of ['1.5', 0, '', 'two']) {
    assert.ok(validateRun({ ...valid, plan_week }).errors.plan_week, `week=${plan_week}`);
  }
  for (const plan_day of ['2.5', 0, '']) {
    assert.ok(validateRun({ ...valid, plan_day }).errors.plan_day, `day=${plan_day}`);
  }
});

test('rejects bad input field by field', () => {
  const { errors } = validateRun({
    ...valid,
    run_date: '2026-02-30',
    duration_seconds: NaN,
    temperature_f: '',
    location: 'gym',
    run_type: 'intervals',
    notes: 'x'.repeat(5001),
  });
  assert.deepEqual(Object.keys(errors).sort(), ['duration_seconds', 'location', 'notes', 'run_date', 'run_type', 'temperature_f']);
  assert.ok(validateRun(null).errors);
});
