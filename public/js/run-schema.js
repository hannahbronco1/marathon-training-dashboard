// Shape of a logged run. Shared by the browser and the Worker so both
// validate the same way. Field names match the Supabase `runs` table.

export const RUN_TYPES = [
  { value: 'easy', label: 'Easy' },
  { value: 'long', label: 'Long' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'race', label: 'Race' },
  { value: 'other', label: 'Other' },
];

export const LOCATIONS = [
  { value: 'outside', label: 'Outside' },
  { value: 'inside', label: 'Inside' },
];

export const LIMITS = {
  maxWeek: 99,
  maxDay: 14,
  maxMiles: 200,
  maxDurationSeconds: 48 * 3600,
  minTemperatureF: -60,
  maxTemperatureF: 140,
  maxConditions: 200,
  maxFood: 1000,
  maxNotes: 5000,
  maxWeeklyTarget: 300,
};

const RUN_TYPE_VALUES = new Set(RUN_TYPES.map((t) => t.value));
const LOCATION_VALUES = new Set(LOCATIONS.map((l) => l.value));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function runTypeLabel(value) {
  return RUN_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function locationLabel(value) {
  return LOCATIONS.find((l) => l.value === value)?.label ?? value;
}

function isRealDate(text) {
  if (!ISO_DATE.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

// Whole number from a number or numeric string; NaN otherwise.
function wholeNumber(value) {
  if (isBlank(value)) return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

// Free text is stored exactly as written. Only an empty entry becomes null.
function journalText(value, max, field, errors) {
  if (isBlank(value)) return null;
  if (typeof value !== 'string') {
    errors[field] = 'Enter text.';
    return null;
  }
  if (value.length > max) errors[field] = `Keep this under ${max} characters.`;
  return value;
}

// Returns { value } with a clean run object, or { errors } keyed by field.
export function validateRun(input) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};

  const runDate = typeof src.run_date === 'string' ? src.run_date.trim() : '';
  if (!isRealDate(runDate)) errors.run_date = 'Enter a valid date.';

  const week = wholeNumber(src.plan_week);
  if (!(week >= 1 && week <= LIMITS.maxWeek)) errors.plan_week = 'Week # is a whole number, 1 or more.';

  const day = wholeNumber(src.plan_day);
  if (!(day >= 1 && day <= LIMITS.maxDay)) errors.plan_day = 'Day # is a whole number, 1 or more.';

  const miles = isBlank(src.miles) ? NaN : Number(src.miles);
  if (!(miles > 0 && miles <= LIMITS.maxMiles)) errors.miles = 'Miles must be more than 0.';

  const duration = Number(src.duration_seconds);
  if (!Number.isInteger(duration) || duration <= 0 || duration > LIMITS.maxDurationSeconds) {
    errors.duration_seconds = 'Enter a valid duration (hh:mm:ss).';
  }

  const temperature = isBlank(src.temperature_f) ? NaN : Number(src.temperature_f);
  if (!(temperature >= LIMITS.minTemperatureF && temperature <= LIMITS.maxTemperatureF)) {
    errors.temperature_f = 'Enter the temperature in °F.';
  }

  const conditions = isBlank(src.conditions) ? null : String(src.conditions).trim();
  if (conditions && conditions.length > LIMITS.maxConditions) {
    errors.conditions = `Keep conditions under ${LIMITS.maxConditions} characters.`;
  }

  if (!LOCATION_VALUES.has(src.location)) errors.location = 'Pick inside or outside.';
  if (!RUN_TYPE_VALUES.has(src.run_type)) errors.run_type = 'Pick a run type.';

  const foodPre = journalText(src.food_pre, LIMITS.maxFood, 'food_pre', errors);
  const foodDuring = journalText(src.food_during, LIMITS.maxFood, 'food_during', errors);
  const foodPost = journalText(src.food_post, LIMITS.maxFood, 'food_post', errors);
  const notes = journalText(src.notes, LIMITS.maxNotes, 'notes', errors);

  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      run_date: runDate,
      plan_week: week,
      plan_day: day,
      miles: Math.round(miles * 100) / 100,
      duration_seconds: duration,
      temperature_f: Math.round(temperature * 10) / 10,
      conditions,
      location: src.location,
      run_type: src.run_type,
      food_pre: foodPre,
      food_during: foodDuring,
      food_post: foodPost,
      notes,
    },
  };
}

// A weekly mileage target the runner sets for one plan week. Returns
// { value } or { errors } like validateRun. The site never suggests one.
export function validateTarget(input) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};

  const week = wholeNumber(src.plan_week);
  if (!(week >= 1 && week <= LIMITS.maxWeek)) errors.plan_week = 'Pick a plan week.';

  const miles = isBlank(src.target_miles) ? NaN : Number(src.target_miles);
  if (!(miles > 0 && miles <= LIMITS.maxWeeklyTarget)) errors.target_miles = 'Enter a target of more than 0 miles.';

  if (Object.keys(errors).length) return { errors };
  return { value: { plan_week: week, target_miles: Math.round(miles * 100) / 100 } };
}
