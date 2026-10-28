import { ApiError, askCoach, createStore, passcode } from './store.js';
import { renderChart } from './charts.js';
import { RUN_TYPES, runTypeLabel, validateRun } from './run-schema.js';
import * as S from './stats.js';

const VIEWS = ['dashboard', 'timeline', 'weekly'];
const RANGES = [8, 12, 26, 52];
const PREFS_KEY = 'mtd.prefs';
const EFFORT_LABELS = {
  1: 'very easy',
  3: 'easy',
  5: 'moderate',
  7: 'hard',
  9: 'very hard',
  10: 'all out',
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ unit: state.unit, range: state.range }));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

const prefs = loadPrefs();
const state = {
  store: null,
  runs: [],
  loaded: false,
  unit: prefs.unit === 'mi' ? 'mi' : 'km',
  range: RANGES.includes(prefs.range) ? prefs.range : 12,
  editingId: null,
};

// Builds an element. Children may be strings (inserted as text) or nodes.
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

// ---------- Formatting shortcuts (current unit) ----------

const dist = (km, digits = 1) => S.formatDistance(km, state.unit, digits);
const pace = (seconds, km) => S.formatPace(S.paceSeconds(seconds, km, state.unit), state.unit);
const unitLabel = () => S.UNITS[state.unit].label;

function deltaText(current, previous, label) {
  const change = S.percentChange(current, previous);
  if (change === null) return current ? `Nothing logged ${label}` : '';
  if (Math.abs(change) < 0.005) return `Same as ${label}`;
  const arrow = change > 0 ? '▲' : '▼';
  return `${arrow} ${Math.round(Math.abs(change) * 100)}% vs ${label} (${dist(previous)})`;
}

// ---------- Toast & banner ----------

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

function showBanner(...children) {
  const banner = $('#banner');
  banner.replaceChildren(...children);
  banner.hidden = children.length === 0;
}

function handleError(err) {
  if (err instanceof ApiError && err.status === 401) {
    openPasscodeDialog(passcode.get() ? 'That passcode didn’t work. Try again.' : null);
    return;
  }
  console.error(err);
  toast(err.message || 'Something went wrong.');
}

// ---------- Dashboard ----------

function renderTable(wrap, headers, rows) {
  wrap.replaceChildren(
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, headers.map((text) => h('th', { scope: 'col' }, text)))),
      h(
        'tbody',
        {},
        rows.map((row) => h('tr', {}, row.map((cell, i) => (i === 0 ? h('th', { scope: 'row' }, cell) : h('td', {}, cell))))),
      ),
    ),
  );
}

function renderChartCard(id, sub, spec, table) {
  const card = $(`#${id}`);
  $('[data-chart-sub]', card).textContent = sub;
  renderChart($('.chart-plot', card), spec);
  renderTable($('.table-wrap', card), table.headers, table.rows);
}

const compactNumber = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const paceTick = (s) => S.formatPace(s, state.unit).split(' ')[0];

function renderDashboard() {
  const hasRuns = state.runs.length > 0;
  $('#dashboard-empty').hidden = hasRuns;
  $('#dashboard-content').hidden = !hasRuns;
  if (!hasRuns) return;

  const weeks = S.recentWeeks(state.runs, state.range);
  const thisWeek = weeks.at(-1);
  const lastWeek = weeks.at(-2);

  $('#week-range').textContent = S.formatWeekRange(thisWeek.weekStart);
  $('#hero-distance').textContent = dist(thisWeek.distanceKm);
  $('#hero-delta').textContent = thisWeek.distanceKm
    ? deltaText(thisWeek.distanceKm, lastWeek.distanceKm, 'last week')
    : `Last week: ${dist(lastWeek.distanceKm)}`;
  $('#tile-runs').textContent = thisWeek.runCount;
  $('#tile-time').textContent = S.formatHours(thisWeek.durationSeconds);
  $('#tile-pace').textContent = thisWeek.runCount ? pace(thisWeek.durationSeconds, thisWeek.distanceKm) : '–';
  $('#tile-longest').textContent = thisWeek.runCount ? dist(thisWeek.longestKm) : '–';

  for (const button of $$('[data-range]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.range) === state.range));
  }

  const weekTitle = (w) => `Week of ${S.formatShortDate(w.weekStart)}${w === thisWeek ? ' (so far)' : ''}`;
  const runsText = (n) => `${n} run${n === 1 ? '' : 's'}`;

  renderChartCard(
    'chart-weekly',
    `${unitLabel()} per week, last ${state.range} weeks`,
    {
      kind: 'column',
      ariaLabel: `Weekly distance in ${unitLabel()} for the last ${state.range} weeks`,
      yFormat: compactNumber,
      valueFormat: (v) => v.toFixed(1),
      points: weeks.map((w) => ({
        label: S.formatShortDate(w.weekStart),
        value: S.toUnit(w.distanceKm, state.unit),
        tooltip: { value: dist(w.distanceKm), title: weekTitle(w), detail: runsText(w.runCount) },
      })),
    },
    {
      headers: ['Week of', `Distance (${unitLabel()})`, 'Runs'],
      rows: [...weeks].reverse().map((w) => [S.formatShortDate(w.weekStart), S.toUnit(w.distanceKm, state.unit).toFixed(1), w.runCount]),
    },
  );

  renderChartCard(
    'chart-long',
    `Longest run each week, ${unitLabel()}`,
    {
      kind: 'line',
      ariaLabel: `Longest run each week in ${unitLabel()}`,
      yFormat: compactNumber,
      valueFormat: (v) => v.toFixed(1),
      points: weeks.map((w) => ({
        label: S.formatShortDate(w.weekStart),
        value: w.longestKm ? S.toUnit(w.longestKm, state.unit) : null,
        tooltip: { value: w.longestKm ? dist(w.longestKm) : 'No runs', title: weekTitle(w) },
      })),
    },
    {
      headers: ['Week of', `Longest (${unitLabel()})`],
      rows: [...weeks].reverse().map((w) => [S.formatShortDate(w.weekStart), w.longestKm ? S.toUnit(w.longestKm, state.unit).toFixed(1) : '–']),
    },
  );

  const weekPace = (w) => (w.runCount ? S.paceSeconds(w.durationSeconds, w.distanceKm, state.unit) : null);
  renderChartCard(
    'chart-pace',
    `Average pace each week, ${S.UNITS[state.unit].paceLabel} · lower is faster`,
    {
      kind: 'line',
      yZero: false,
      ariaLabel: `Average pace each week, minutes per ${unitLabel()}`,
      yFormat: paceTick,
      valueFormat: paceTick,
      points: weeks.map((w) => ({
        label: S.formatShortDate(w.weekStart),
        value: weekPace(w),
        tooltip: {
          value: w.runCount ? pace(w.durationSeconds, w.distanceKm) : 'No runs',
          title: weekTitle(w),
          detail: w.runCount ? `${dist(w.distanceKm)} in ${S.formatHours(w.durationSeconds)}` : null,
        },
      })),
    },
    {
      headers: ['Week of', `Avg pace (${S.UNITS[state.unit].paceLabel})`],
      rows: [...weeks].reverse().map((w) => [S.formatShortDate(w.weekStart), w.runCount ? paceTick(weekPace(w)) : '–']),
    },
  );

  $('#storage-note').textContent =
    state.store.kind === 'local'
      ? 'Runs are saved in this browser only. Connect Supabase to keep them safe and sync across devices.'
      : 'Runs are saved to your Supabase database.';
}

// ---------- Timeline ----------

function runItem(run) {
  const meta = [S.formatLongDate(run.run_date), runTypeLabel(run.run_type)];
  if (run.effort) meta.push(`effort ${run.effort}/10`);
  return h(
    'li',
    {},
    h(
      'button',
      { type: 'button', class: 'run-item', onclick: () => openRunDialog(run) },
      h('span', { class: 'run-dot', 'aria-hidden': 'true' }),
      h(
        'span',
        { class: 'run-body' },
        h('span', { class: 'run-meta' }, meta.join(' · ')),
        h(
          'span',
          { class: 'run-main' },
          h('strong', {}, dist(run.distance_km, 2)),
          ` in ${S.formatDuration(run.duration_seconds)} · ${pace(run.duration_seconds, run.distance_km)}`,
        ),
        run.notes && h('span', { class: 'run-notes' }, run.notes),
      ),
    ),
  );
}

function renderTimeline() {
  const list = $('#timeline');
  $('#timeline-empty').hidden = state.runs.length > 0;
  const byWeek = new Map();
  for (const run of S.sortRunsDesc(state.runs)) {
    const key = S.weekStart(run.run_date);
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(run);
  }
  list.replaceChildren(
    ...[...byWeek].map(([start, runs]) => {
      const total = runs.reduce((sum, r) => sum + Number(r.distance_km), 0);
      return h(
        'li',
        { class: 'timeline-week' },
        h(
          'h3',
          { class: 'timeline-week-title' },
          h('span', {}, `Week of ${S.formatYearDate(start)}`),
          h('span', { class: 'timeline-week-total' }, `${dist(total)} · ${runs.length} run${runs.length === 1 ? '' : 's'}`),
        ),
        h('ol', { class: 'timeline-runs' }, runs.map(runItem)),
      );
    }),
  );
}

// ---------- Weekly summaries ----------

function renderWeekly() {
  const list = $('#weeks');
  const weeks = S.allWeeks(state.runs);
  $('#weekly-empty').hidden = weeks.length > 0;
  const peak = Math.max(0, ...weeks.map((w) => w.distanceKm));
  const currentWeek = S.weekStart(S.todayISO());

  list.replaceChildren(
    ...weeks
      .map((week, i) => {
        const previous = weeks[i - 1];
        const isCurrent = week.weekStart === currentWeek;
        const title = h(
          'h3',
          {},
          S.formatWeekRange(week.weekStart),
          isCurrent && h('span', { class: 'tag' }, 'This week'),
        );
        if (!week.runCount) {
          return h('li', { class: 'week week-empty' }, title, h('span', { class: 'sub' }, 'No runs'));
        }
        const share = peak ? (week.distanceKm / peak) * 100 : 0;
        return h(
          'li',
          { class: 'week card' },
          title,
          h('p', { class: 'week-distance' }, dist(week.distanceKm)),
          previous && h('p', { class: 'delta' }, deltaText(week.distanceKm, previous.distanceKm, 'the previous week')),
          h(
            'div',
            { class: 'meter', role: 'img', 'aria-label': `${Math.round(share)}% of your biggest week` },
            h('span', { style: `width: ${share.toFixed(1)}%` }),
          ),
          h(
            'dl',
            { class: 'tiles' },
            h('div', {}, h('dt', {}, 'Runs'), h('dd', {}, week.runCount)),
            h('div', {}, h('dt', {}, 'Time'), h('dd', {}, S.formatHours(week.durationSeconds))),
            h('div', {}, h('dt', {}, 'Avg pace'), h('dd', {}, pace(week.durationSeconds, week.distanceKm))),
            h('div', {}, h('dt', {}, 'Longest'), h('dd', {}, dist(week.longestKm))),
          ),
        );
      })
      .reverse(),
  );
}

// ---------- Rendering & routing ----------

function render() {
  for (const el of $$('[data-unit-label]')) el.textContent = unitLabel();
  if (!state.loaded) return;
  renderDashboard();
  renderTimeline();
  renderWeekly();
}

function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  for (const name of VIEWS) $(`#view-${name}`).hidden = !state.loaded || name !== view;
  for (const tab of $$('.tab[data-view]')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

async function loadRuns() {
  try {
    state.runs = await state.store.list();
    state.loaded = true;
    $('#loading').hidden = true;
    render();
    route();
    offerLocalImport();
  } catch (err) {
    $('#loading').textContent = err.status === 401 ? 'Locked. Enter your passcode to see your runs.' : `Couldn’t load runs: ${err.message}`;
    handleError(err);
  }
}

// After Supabase is connected, offer to upload runs logged on this device.
function offerLocalImport() {
  const pending = state.store.localRuns();
  if (!pending.length) return showBanner();
  const button = h('button', { type: 'button', class: 'btn small' }, 'Upload');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await state.store.importLocalRuns();
      showBanner();
      toast(`Uploaded ${pending.length} run${pending.length === 1 ? '' : 's'}`);
      await loadRuns();
    } catch (err) {
      button.disabled = false;
      handleError(err);
    }
  });
  const what = pending.length === 1 ? '1 run saved on this device isn’t' : `${pending.length} runs saved on this device aren’t`;
  showBanner(h('span', {}, `${what} in Supabase yet.`), button);
}

// ---------- Run dialog ----------

function buildRunForm() {
  $('#type-chips').replaceChildren(
    ...RUN_TYPES.map((type) =>
      h('label', { class: 'chip' }, h('input', { type: 'radio', name: 'run_type', value: type.value }), h('span', {}, type.label)),
    ),
  );
  $('#run-effort').replaceChildren(
    h('option', { value: '' }, 'Not set'),
    ...Array.from({ length: 10 }, (_, i) => {
      const n = i + 1;
      return h('option', { value: n }, EFFORT_LABELS[n] ? `${n} · ${EFFORT_LABELS[n]}` : String(n));
    }),
  );
}

function clearFieldErrors(form) {
  for (const el of $$('.field-error', form)) el.textContent = '';
}

function readDuration(form) {
  return S.toSeconds(form.hours.value, form.minutes.value, form.seconds.value);
}

function updatePacePreview() {
  const form = $('#run-form');
  const seconds = readDuration(form);
  const km = S.fromUnit(Number(form.distance.value), state.unit);
  $('#pace-preview').textContent = seconds > 0 && km > 0 ? `Pace ${pace(seconds, km)}` : '';
}

function openRunDialog(run = null) {
  const form = $('#run-form');
  const dialog = $('#run-dialog');
  form.reset();
  clearFieldErrors(form);
  state.editingId = run?.id ?? null;

  $('#run-dialog-title').textContent = run ? 'Edit run' : 'Log a run';
  $('#delete-run').hidden = !run;
  form.run_date.value = run?.run_date ?? S.todayISO();
  form.distance.value = run ? S.toUnit(run.distance_km, state.unit).toFixed(2) : '';
  const parts = run ? S.splitSeconds(run.duration_seconds) : null;
  form.hours.value = parts?.hours || '';
  form.minutes.value = parts ? parts.minutes : '';
  form.seconds.value = parts ? parts.seconds : '';
  form.run_type.value = run?.run_type ?? 'easy';
  form.effort.value = run?.effort ?? '';
  form.notes.value = run?.notes ?? '';
  updatePacePreview();

  dialog.showModal();
  if (!run) form.distance.focus();
}

async function saveRun(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);

  const { value, errors } = validateRun({
    run_date: form.run_date.value,
    distance_km: S.fromUnit(Number(form.distance.value), state.unit),
    duration_seconds: readDuration(form),
    run_type: form.run_type.value,
    effort: form.effort.value,
    notes: form.notes.value,
  });
  if (errors) {
    for (const [field, message] of Object.entries(errors)) {
      const slot = $(`[data-error-for="${field}"]`, form);
      if (slot) slot.textContent = message;
    }
    return;
  }

  const submit = $('button[type="submit"]', form);
  submit.disabled = true;
  try {
    if (state.editingId) {
      const updated = await state.store.update(state.editingId, value);
      state.runs = state.runs.map((r) => (r.id === updated.id ? updated : r));
    } else {
      state.runs = [...state.runs, await state.store.create(value)];
    }
    $('#run-dialog').close();
    render();
    toast(state.editingId ? 'Run updated' : 'Run saved');
  } catch (err) {
    if (err instanceof ApiError && err.fields) {
      for (const [field, message] of Object.entries(err.fields)) {
        const slot = $(`[data-error-for="${field}"]`, form);
        if (slot) slot.textContent = message;
      }
    } else if (err instanceof ApiError && err.status === 401) {
      handleError(err);
    } else {
      $('[data-error-for="form"]', form).textContent = `Couldn’t save: ${err.message}`;
    }
  } finally {
    submit.disabled = false;
  }
}

async function deleteRun() {
  if (!state.editingId || !confirm('Delete this run? This can’t be undone.')) return;
  try {
    await state.store.remove(state.editingId);
    state.runs = state.runs.filter((r) => r.id !== state.editingId);
    $('#run-dialog').close();
    render();
    toast('Run deleted');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) handleError(err);
    else $('#run-form [data-error-for="form"]').textContent = `Couldn’t delete: ${err.message}`;
  }
}

// ---------- Passcode ----------

function openPasscodeDialog(message) {
  const dialog = $('#passcode-dialog');
  if (message) $('#passcode-message').textContent = message;
  if (!dialog.open) dialog.showModal();
  $('#passcode-input').focus();
}

// ---------- Coach ----------

async function requestCoach(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const reply = $('#coach-reply');
  const button = $('button', form);
  button.disabled = true;
  button.textContent = 'Thinking…';
  try {
    const runs = S.sortRunsDesc(state.runs).slice(0, 60);
    reply.textContent = await askCoach(runs, state.unit, form.question.value);
    reply.hidden = false;
  } catch (err) {
    handleError(err);
  } finally {
    button.disabled = false;
    button.textContent = 'Get feedback';
  }
}

// ---------- Setup ----------

function wireEvents() {
  window.addEventListener('hashchange', route);
  for (const el of $$('[data-open-log]')) el.addEventListener('click', () => openRunDialog());
  for (const el of $$('[data-close]')) el.addEventListener('click', () => el.closest('dialog').close());

  $('#unit-toggle').addEventListener('click', () => {
    state.unit = state.unit === 'km' ? 'mi' : 'km';
    savePrefs();
    render();
    updatePacePreview();
  });

  for (const button of $$('[data-range]')) {
    button.addEventListener('click', () => {
      state.range = Number(button.dataset.range);
      savePrefs();
      renderDashboard();
    });
  }

  const runForm = $('#run-form');
  runForm.addEventListener('submit', saveRun);
  runForm.addEventListener('input', () => {
    clearFieldErrors(runForm);
    updatePacePreview();
  });
  $('#delete-run').addEventListener('click', deleteRun);

  // Tapping the backdrop closes a sheet.
  for (const dialog of $$('dialog.sheet:not(.small)')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  $('#passcode-form').addEventListener('submit', (event) => {
    event.preventDefault();
    passcode.set($('#passcode-input').value);
    $('#passcode-dialog').close();
    $('#passcode-input').value = '';
    loadRuns();
  });

  $('#coach-form').addEventListener('submit', requestCoach);
}

async function init() {
  buildRunForm();
  wireEvents();
  render();
  state.store = await createStore();
  $('#coach-card').hidden = !state.store.config.coach;
  await loadRuns();
}

init();
