// Pure date, plan-week and summary helpers. No DOM access, so they run under
// `node --test` as well as in the browser.

import { PLAN } from './plan.js';

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

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

export function daysBetween(fromIso, toIso) {
  return Math.round((parseDate(toIso) - parseDate(fromIso)) / DAY_MS);
}

// ---------- Plan weeks ----------

// Monday of the week containing a date.
export function mondayOf(iso) {
  const offset = (parseDate(iso).getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
}

// Week # of the plan for a date, or null before Week 1. Plan weeks run
// Monday to Sunday, and Week 1 is the week containing PLAN.startDate.
export function planWeekFor(iso, start = PLAN.startDate) {
  const days = daysBetween(mondayOf(start), iso);
  return days < 0 ? null : Math.floor(days / 7) + 1;
}

// Monday that begins a plan week.
export function planWeekStart(week, start = PLAN.startDate) {
  return addDays(mondayOf(start), (week - 1) * 7);
}

// The next Day # for a run on `date`: one more than the runs already logged
// that week on or before that date.
export function nextPlanDay(runs, week, date, excludeId = null) {
  const earlier = runs.filter((r) => r.id !== excludeId && r.plan_week === week && r.run_date <= date);
  return earlier.length + 1;
}

// ---------- Formatting ----------

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

// Two-digit week code, e.g. W04.
export function weekCode(week) {
  return `W${pad(week)}`;
}

// Race-bib style date, e.g. SUN 03.07.27.
export function formatBibDate(iso) {
  const date = parseDate(iso);
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getUTCDay()];
  return `${weekday} ${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}.${String(date.getUTCFullYear()).slice(2)}`;
}

// Days until race day (0 on the day, negative after), the plan week today
// falls in (null before Week 1), and how many weeks the plan has.
export function raceCountdown(today = todayISO()) {
  return {
    days: daysBetween(today, PLAN.raceDate),
    week: planWeekFor(today),
    totalWeeks: planWeekFor(PLAN.raceDate),
  };
}

export function formatWeekRange(week) {
  const start = planWeekStart(week);
  return `${formatShortDate(start)} – ${formatShortDate(addDays(start, 6))}`;
}

// Hours, minutes and seconds from form fields (blank counts as 0). Minutes
// and seconds must be 0–59. Returns whole seconds, or NaN if invalid.
export function toSeconds(hours, minutes, seconds) {
  const parts = [hours, minutes, seconds].map((v) => (v === '' || v == null ? 0 : Number(v)));
  if (parts.some((v) => !Number.isInteger(v) || v < 0)) return NaN;
  if (parts[1] > 59 || parts[2] > 59) return NaN;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function splitSeconds(total) {
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: Math.round(total % 60),
  };
}

// hh:mm:ss, e.g. 0:45:30 or 2:41:00.
export function formatDuration(total) {
  const { hours, minutes, seconds } = splitSeconds(Math.round(total));
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

// Hours and minutes only, for weekly totals ("5h 20m").
export function formatHours(total) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatMiles(miles, digits = 2) {
  return `${Number(miles).toFixed(digits)} mi`;
}

// Miles without trailing zeros: 10.7, 3.25, 6.
export function shortMiles(miles) {
  return String(Number(Number(miles).toFixed(2)));
}

// Seconds per mile.
export function paceSeconds(durationSeconds, miles) {
  return miles > 0 ? durationSeconds / miles : null;
}

export function formatPace(secondsPerMile, withUnit = true) {
  if (secondsPerMile == null || !Number.isFinite(secondsPerMile)) return '–';
  const total = Math.round(secondsPerMile);
  return `${Math.floor(total / 60)}:${pad(total % 60)}${withUnit ? '/mi' : ''}`;
}

export function formatTemperature(f) {
  return `${Number(f)}°F`;
}

// ---------- Sorting & summaries ----------

export function sortRunsDesc(runs) {
  return [...runs].sort(
    (a, b) =>
      b.run_date.localeCompare(a.run_date) ||
      b.plan_day - a.plan_day ||
      (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );
}

function emptyWeek(week) {
  return { week, miles: 0, durationSeconds: 0, runCount: 0, longestMiles: 0, runs: [] };
}

// One entry per plan week from Week 1 to `lastWeek`, using each run's
// stored Week #. Weeks without runs are included so gaps show.
export function summarizeWeeks(runs, lastWeek) {
  const weeks = Array.from({ length: Math.max(lastWeek, 0) }, (_, i) => emptyWeek(i + 1));
  for (const run of runs) {
    const week = weeks[run.plan_week - 1];
    if (!week) continue;
    const miles = Number(run.miles);
    week.miles += miles;
    week.durationSeconds += run.duration_seconds;
    week.runCount += 1;
    week.longestMiles = Math.max(week.longestMiles, miles);
    week.runs.push(run);
  }
  return weeks;
}

// The plan week to show as "current": today's week, or a later week if
// runs were logged ahead, and at least Week 1.
export function currentPlanWeek(runs, today = todayISO()) {
  const byDate = planWeekFor(today) ?? 1;
  return runs.reduce((max, r) => Math.max(max, r.plan_week), byDate);
}

// Signed fractional change, or null when there's no baseline.
export function percentChange(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous;
}
