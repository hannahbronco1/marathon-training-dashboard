// Shape of a logged run. Shared by the browser and the Worker so both
// validate the same way. Field names match the Supabase `runs` table.

export const RUN_TYPES = [
  { value: 'easy', label: 'Easy' },
  { value: 'long', label: 'Long' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'intervals', label: 'Intervals' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'race', label: 'Race' },
];

const RUN_TYPE_VALUES = new Set(RUN_TYPES.map((t) => t.value));
const MAX_DISTANCE_KM = 500;
const MAX_DURATION_SECONDS = 48 * 3600;
const MAX_NOTES_LENGTH = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function runTypeLabel(value) {
  return RUN_TYPES.find((t) => t.value === value)?.label ?? value;
}

function isRealDate(text) {
  if (!ISO_DATE.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Returns { value } with a clean run object, or { errors } keyed by field.
export function validateRun(input) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};

  const runDate = typeof src.run_date === 'string' ? src.run_date.trim() : '';
  if (!isRealDate(runDate)) errors.run_date = 'Enter a valid date.';

  const distance = Number(src.distance_km);
  if (!Number.isFinite(distance) || distance <= 0 || distance > MAX_DISTANCE_KM) {
    errors.distance_km = 'Enter a distance greater than 0.';
  }

  const duration = Number(src.duration_seconds);
  if (!Number.isInteger(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
    errors.duration_seconds = 'Enter how long the run took.';
  }

  const runType = src.run_type ?? 'easy';
  if (!RUN_TYPE_VALUES.has(runType)) errors.run_type = 'Pick a run type.';

  let effort = null;
  if (src.effort !== null && src.effort !== undefined && src.effort !== '') {
    effort = Number(src.effort);
    if (!Number.isInteger(effort) || effort < 1 || effort > 10) {
      errors.effort = 'Effort is a whole number from 1 to 10.';
    }
  }

  const notes = typeof src.notes === 'string' ? src.notes.trim() : '';
  if (notes.length > MAX_NOTES_LENGTH) errors.notes = `Keep notes under ${MAX_NOTES_LENGTH} characters.`;

  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      run_date: runDate,
      distance_km: Math.round(distance * 100) / 100,
      duration_seconds: duration,
      run_type: runType,
      effort,
      notes: notes || null,
    },
  };
}
