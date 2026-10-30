// CSV and JSON export/import for runs (and, in JSON, weekly targets).
// Pure functions with no DOM access, so they run under `node --test`.
//
// Free text (conditions aside) is kept exactly as written in both
// directions: no trimming, and commas, quotes and line breaks survive.

import { PLAN } from './plan.js';
import { validateRun, validateTarget } from './run-schema.js';
import * as S from './stats.js';

export const BACKUP_VERSION = 1;

// Column order for CSV files. `pace` is written for reading in a
// spreadsheet and ignored on import.
export const CSV_COLUMNS = [
  'run_date',
  'plan_week',
  'plan_day',
  'miles',
  'duration',
  'pace',
  'temperature_f',
  'conditions',
  'location',
  'run_type',
  'food_pre',
  'food_during',
  'food_post',
  'notes',
];

// Other header names a hand-made spreadsheet might use.
const HEADER_ALIASES = {
  date: 'run_date',
  week: 'plan_week',
  'week #': 'plan_week',
  day: 'plan_day',
  'day #': 'plan_day',
  distance: 'miles',
  time: 'duration',
  temperature: 'temperature_f',
  temp: 'temperature_f',
  where: 'location',
  type: 'run_type',
  'pre-run': 'food_pre',
  pre: 'food_pre',
  during: 'food_during',
  'post-run': 'food_post',
  post: 'food_post',
};

// ---------- CSV text ----------

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSVText(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

// Parses CSV (RFC 4180: quoted cells may hold commas, quotes and newlines).
// Returns an array of rows, each an array of cell strings.
export function parseCSVText(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Drop completely empty lines (e.g. a trailing newline).
  return rows.filter((r) => r.some((c) => c !== ''));
}

// ---------- Export ----------

export function runsToCSV(runs) {
  const rows = S.sortRunsDesc(runs)
    .reverse()
    .map((r) => [
      r.run_date,
      r.plan_week,
      r.plan_day,
      Number(r.miles).toFixed(2),
      S.formatDuration(r.duration_seconds),
      S.formatPace(S.paceSeconds(r.duration_seconds, Number(r.miles)), false),
      Number(r.temperature_f),
      r.conditions,
      r.location,
      r.run_type,
      r.food_pre,
      r.food_during,
      r.food_post,
      r.notes,
    ]);
  // The byte-order mark helps Excel read ° and accented letters correctly.
  return `﻿${toCSVText([CSV_COLUMNS, ...rows])}\r\n`;
}

export function csvTemplate() {
  return `﻿${toCSVText([CSV_COLUMNS])}\r\n`;
}

export function backupJSON(runs, targets, exportedAt = new Date().toISOString()) {
  const runFields = ({ run_date, plan_week, plan_day, miles, duration_seconds, temperature_f, conditions, location, run_type, food_pre, food_during, food_post, notes, created_at }) => ({
    run_date,
    plan_week,
    plan_day,
    miles: Number(miles),
    duration_seconds,
    temperature_f: Number(temperature_f),
    conditions: conditions ?? null,
    location,
    run_type,
    food_pre: food_pre ?? null,
    food_during: food_during ?? null,
    food_post: food_post ?? null,
    notes: notes ?? null,
    created_at: created_at ?? null,
  });
  return JSON.stringify(
    {
      app: 'marathon-training-dashboard',
      version: BACKUP_VERSION,
      exported_at: exportedAt,
      plan: PLAN,
      runs: S.sortRunsDesc(runs).reverse().map(runFields),
      targets: [...targets.entries()].sort(([a], [b]) => a - b).map(([plan_week, target_miles]) => ({ plan_week, target_miles })),
    },
    null,
    2,
  );
}

export function exportFileName(kind, today = S.todayISO()) {
  return kind === 'json' ? `marathon-backup-${today}.json` : `marathon-runs-${today}.csv`;
}

// ---------- Import ----------

// "1:02:03", "02:02:15", "38:24" or a plain number of seconds.
export function parseDuration(text) {
  const value = String(text ?? '').trim();
  if (/^\d+$/.test(value)) return Number(value);
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return NaN;
  const [h, m, s] = parts.length === 3 ? parts : ['0', ...parts];
  return S.toSeconds(h, m, s);
}

// Numbers typed with units ("3.2 mi", "76°F") still count.
function looseNumber(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (text === '') return '';
  const match = text.match(/^-?\d+(\.\d+)?/);
  return match ? match[0] : text;
}

const lower = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// Turns one imported record into the shape validateRun expects.
function normalizeRecord(record) {
  return {
    run_date: typeof record.run_date === 'string' ? record.run_date.trim() : record.run_date,
    plan_week: looseNumber(record.plan_week),
    plan_day: looseNumber(record.plan_day),
    miles: looseNumber(record.miles),
    duration_seconds:
      record.duration_seconds !== undefined && record.duration_seconds !== ''
        ? Number(record.duration_seconds)
        : parseDuration(record.duration),
    temperature_f: looseNumber(record.temperature_f),
    conditions: record.conditions,
    location: lower(record.location),
    run_type: lower(record.run_type),
    food_pre: record.food_pre,
    food_during: record.food_during,
    food_post: record.food_post,
    notes: record.notes,
  };
}

export function recordsFromCSV(text) {
  const rows = parseCSVText(text);
  if (!rows.length) return { records: [], problems: ['The file is empty.'] };
  const headers = rows[0].map((h) => {
    const key = h.trim().toLowerCase();
    return HEADER_ALIASES[key] ?? key;
  });
  if (!headers.includes('run_date')) {
    return { records: [], problems: ['The first row needs column names, including run_date (or date).'] };
  }
  const records = rows.slice(1).map((cells, i) => {
    const record = { _line: i + 2 };
    headers.forEach((key, j) => {
      if (key && cells[j] !== undefined) record[key] = cells[j];
    });
    return record;
  });
  return { records, problems: [] };
}

export function recordsFromJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { records: [], targets: [], problems: ['This isn’t a valid JSON file.'] };
  }
  const runs = Array.isArray(data) ? data : data?.runs;
  if (!Array.isArray(runs)) return { records: [], targets: [], problems: ['No runs found in this file.'] };
  const targets = Array.isArray(data?.targets) ? data.targets : [];
  return { records: runs.map((r, i) => ({ ...r, _line: i + 1 })), targets, problems: [] };
}

const runKey = (r) => `${r.run_date}#${r.plan_day}`;

// Checks every record and works out what would be added. Week # and Day #
// left blank are filled in from the date. Nothing is saved here.
//   -> { toAdd, duplicates, problems, targets }
export function planImport({ records, targets = [], problems = [] }, existingRuns, label = 'Row') {
  const result = { toAdd: [], duplicates: 0, problems: [...problems], targets: [] };
  const known = new Set(existingRuns.map(runKey));
  const counted = [...existingRuns];

  // Oldest first, so filled-in Day # values count up in date order.
  const ordered = [...records].sort((a, b) => String(a.run_date ?? '').localeCompare(String(b.run_date ?? '')));
  for (const record of ordered) {
    const input = normalizeRecord(record);
    if (input.plan_week === '' && typeof input.run_date === 'string') input.plan_week = S.planWeekFor(input.run_date) ?? '';
    if (input.plan_day === '' && Number(input.plan_week) >= 1 && typeof input.run_date === 'string') {
      input.plan_day = S.nextPlanDay(counted, Number(input.plan_week), input.run_date);
    }
    const { value, errors } = validateRun(input);
    if (errors) {
      result.problems.push(`${label} ${record._line}: ${Object.values(errors).join(' ')}`);
      continue;
    }
    if (known.has(runKey(value))) {
      result.duplicates += 1;
      continue;
    }
    known.add(runKey(value));
    counted.push(value);
    result.toAdd.push(value);
  }

  for (const [i, t] of targets.entries()) {
    const { value, errors } = validateTarget(t);
    if (errors) result.problems.push(`Target ${i + 1}: ${Object.values(errors).join(' ')}`);
    else result.targets.push(value);
  }
  return result;
}

// Reads a file's text by its name: .json as a backup, anything else as CSV.
export function readImportFile(name, text, existingRuns) {
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(text)) return planImport(recordsFromJSON(text), existingRuns, 'Run');
  return planImport(recordsFromCSV(text), existingRuns, 'Row');
}
