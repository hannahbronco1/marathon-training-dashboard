// Pure date, unit and summary helpers. No DOM access, so they run under
// `node --test` as well as in the browser.

export const KM_PER_MILE = 1.609344;

export const UNITS = {
  km: { label: 'km', paceLabel: '/km', perKm: 1 },
  mi: { label: 'mi', paceLabel: '/mi', perKm: 1 / KM_PER_MILE },
};

const pad = (n) => String(n).padStart(2, '0');

// Dates are 'YYYY-MM-DD' strings handled in UTC so a run never shifts a day
// because of the viewer's time zone.
export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso, days) {
  const date = parseDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

// Weeks start on Monday.
export function weekStart(iso) {
  const date = parseDate(iso);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return toISODate(date);
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const yearDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export const formatShortDate = (iso) => shortDate.format(parseDate(iso));
export const formatLongDate = (iso) => longDate.format(parseDate(iso));
export const formatYearDate = (iso) => yearDate.format(parseDate(iso));

export function formatWeekRange(start) {
  return `${formatShortDate(start)} – ${formatShortDate(addDays(start, 6))}`;
}

// Accepts hours, minutes and seconds (any may be blank). Returns whole seconds.
export function toSeconds(hours, minutes, seconds) {
  const parts = [hours, minutes, seconds].map((v) => (v === '' || v == null ? 0 : Number(v)));
  if (parts.some((v) => !Number.isFinite(v) || v < 0)) return NaN;
  return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
}

export function splitSeconds(total) {
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: Math.round(total % 60),
  };
}

export function formatDuration(total) {
  const { hours, minutes, seconds } = splitSeconds(Math.round(total));
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// Hours and minutes only, for weekly totals ("5h 20m").
export function formatHours(total) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function toUnit(km, unit) {
  return km * UNITS[unit].perKm;
}

export function fromUnit(value, unit) {
  return value / UNITS[unit].perKm;
}

export function formatDistance(km, unit, digits = 1) {
  return `${toUnit(km, unit).toFixed(digits)} ${UNITS[unit].label}`;
}

// Seconds per km or per mile.
export function paceSeconds(durationSeconds, km, unit) {
  if (!km) return null;
  return durationSeconds / toUnit(km, unit);
}

export function formatPace(secondsPerUnit, unit) {
  if (secondsPerUnit == null || !Number.isFinite(secondsPerUnit)) return '–';
  const total = Math.round(secondsPerUnit);
  return `${Math.floor(total / 60)}:${pad(total % 60)} ${UNITS[unit].paceLabel}`;
}

export function sortRunsDesc(runs) {
  return [...runs].sort(
    (a, b) => b.run_date.localeCompare(a.run_date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );
}

function emptyWeek(start) {
  return { weekStart: start, distanceKm: 0, durationSeconds: 0, runCount: 0, longestKm: 0, runs: [] };
}

// One entry per week from `fromWeek` to `toWeek` inclusive, oldest first.
// Weeks without runs are included so charts and lists show the gaps.
export function summarizeWeeks(runs, fromWeek, toWeek) {
  const byWeek = new Map();
  for (let start = fromWeek; start <= toWeek; start = addDays(start, 7)) {
    byWeek.set(start, emptyWeek(start));
  }
  for (const run of runs) {
    const week = byWeek.get(weekStart(run.run_date));
    if (!week) continue;
    week.distanceKm += Number(run.distance_km);
    week.durationSeconds += run.duration_seconds;
    week.runCount += 1;
    week.longestKm = Math.max(week.longestKm, Number(run.distance_km));
    week.runs.push(run);
  }
  return [...byWeek.values()];
}

// The most recent `count` weeks ending with the week containing `today`.
export function recentWeeks(runs, count, today = todayISO()) {
  const toWeek = weekStart(today);
  return summarizeWeeks(runs, addDays(toWeek, -7 * (count - 1)), toWeek);
}

// Every week from the first logged run to the current week.
export function allWeeks(runs, today = todayISO()) {
  if (!runs.length) return [];
  const first = runs.reduce((min, r) => (r.run_date < min ? r.run_date : min), runs[0].run_date);
  const last = runs.reduce((max, r) => (r.run_date > max ? r.run_date : max), today);
  return summarizeWeeks(runs, weekStart(first), weekStart(last));
}

// Signed fractional change, or null when there's no baseline.
export function percentChange(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous;
}
