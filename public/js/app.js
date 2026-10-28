import { ApiError, isConfigured, passcode, runsApi } from './store.js';
import { renderChart } from './charts.js';
import { LOCATIONS, RUN_TYPES, locationLabel, runTypeLabel, validateRun } from './run-schema.js';
import * as S from './stats.js';

const VIEWS = ['dashboard', 'timeline', 'runs', 'weekly'];
const PREFS_KEY = 'mtd.prefs';

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
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: state.sort, showJournal: state.showJournal }));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

const prefs = loadPrefs();
const state = {
  runs: [],
  loaded: false,
  editingId: null,
  sort: prefs.sort?.key ? prefs.sort : { key: 'date', dir: 'desc' },
  showJournal: prefs.showJournal === true,
  filters: { week: '', type: '', location: '' },
};

// Builds an element. Children may be strings (inserted as text) or nodes.
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const runPace = (run) => S.paceSeconds(run.duration_seconds, Number(run.miles));
const weekPace = (w) => (w.runCount ? S.paceSeconds(w.durationSeconds, w.miles) : null);

function deltaText(current, previous, label) {
  const change = S.percentChange(current, previous);
  if (change === null) return current ? `Nothing logged ${label}` : '';
  if (Math.abs(change) < 0.005) return `Same as ${label}`;
  const arrow = change > 0 ? '▲' : '▼';
  return `${arrow} ${Math.round(Math.abs(change) * 100)}% vs ${label} (${S.formatMiles(previous, 1)})`;
}

// ---------- Toast ----------

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

function isAuthError(err) {
  return err instanceof ApiError && err.status === 401;
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

function renderChartCard(id, spec, table) {
  const card = $(`#${id}`);
  renderChart($('.chart-plot', card), spec);
  renderTable($('.table-wrap', card), table.headers, table.rows);
}

const compactNumber = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const paceTick = (s) => S.formatPace(s, false);
const weekTitle = (w) => `Week ${w.week} · ${S.formatWeekRange(w.week)}`;

function renderDashboard() {
  const hasRuns = state.runs.length > 0;
  $('#dashboard-empty').hidden = hasRuns;
  $('#dashboard-content').hidden = !hasRuns;
  if (!hasRuns) return;

  const weeks = S.summarizeWeeks(state.runs, S.currentPlanWeek(state.runs));
  const thisWeek = weeks.at(-1);
  const lastWeek = weeks.at(-2);
  const isToday = thisWeek.week === S.planWeekFor(S.todayISO());

  $('#hero-title').textContent = `${isToday ? 'This week · ' : ''}${weekTitle(thisWeek)}`;
  $('#hero-miles').textContent = S.formatMiles(thisWeek.miles, 1);
  $('#hero-delta').textContent = !lastWeek
    ? 'Week 1 of your plan'
    : thisWeek.miles
      ? deltaText(thisWeek.miles, lastWeek.miles, 'last week')
      : `Last week: ${S.formatMiles(lastWeek.miles, 1)}`;
  $('#tile-runs').textContent = thisWeek.runCount;
  $('#tile-time').textContent = S.formatHours(thisWeek.durationSeconds);
  $('#tile-pace').textContent = S.formatPace(weekPace(thisWeek));
  $('#tile-longest').textContent = thisWeek.runCount ? S.formatMiles(thisWeek.longestMiles, 1) : '–';

  const label = (w) => `W${w.week}`;
  const newestFirst = [...weeks].reverse();

  renderChartCard(
    'chart-weekly',
    {
      kind: 'column',
      ariaLabel: 'Miles per plan week',
      yFormat: compactNumber,
      valueFormat: (v) => v.toFixed(1),
      points: weeks.map((w) => ({
        label: label(w),
        value: w.miles,
        tooltip: { value: S.formatMiles(w.miles, 1), title: weekTitle(w), detail: plural(w.runCount, 'run') },
      })),
    },
    {
      headers: ['Week', 'Miles', 'Runs'],
      rows: newestFirst.map((w) => [`Week ${w.week}`, w.miles.toFixed(2), w.runCount]),
    },
  );

  renderChartCard(
    'chart-long',
    {
      kind: 'line',
      ariaLabel: 'Longest run each plan week, in miles',
      yFormat: compactNumber,
      valueFormat: (v) => v.toFixed(1),
      points: weeks.map((w) => ({
        label: label(w),
        value: w.longestMiles || null,
        tooltip: { value: w.longestMiles ? S.formatMiles(w.longestMiles) : 'No runs', title: weekTitle(w) },
      })),
    },
    {
      headers: ['Week', 'Longest (mi)'],
      rows: newestFirst.map((w) => [`Week ${w.week}`, w.longestMiles ? w.longestMiles.toFixed(2) : '–']),
    },
  );

  renderChartCard(
    'chart-pace',
    {
      kind: 'line',
      yZero: false,
      ariaLabel: 'Average pace each plan week, minutes per mile',
      yFormat: paceTick,
      valueFormat: paceTick,
      points: weeks.map((w) => ({
        label: label(w),
        value: weekPace(w),
        tooltip: {
          value: w.runCount ? S.formatPace(weekPace(w)) : 'No runs',
          title: weekTitle(w),
          detail: w.runCount ? `${S.formatMiles(w.miles, 1)} in ${S.formatHours(w.durationSeconds)}` : null,
        },
      })),
    },
    {
      headers: ['Week', 'Avg pace (/mi)'],
      rows: newestFirst.map((w) => [`Week ${w.week}`, w.runCount ? paceTick(weekPace(w)) : '–']),
    },
  );
}

// ---------- Timeline ----------

function runItem(run) {
  const where = [S.formatTemperature(run.temperature_f), run.conditions, locationLabel(run.location)].filter(Boolean);
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
        h('span', { class: 'run-meta' }, `${S.formatLongDate(run.run_date)} · Day ${run.plan_day} · ${runTypeLabel(run.run_type)}`),
        h(
          'span',
          { class: 'run-main' },
          h('strong', {}, S.formatMiles(run.miles)),
          ` in ${S.formatDuration(run.duration_seconds)} · ${S.formatPace(runPace(run))}`,
        ),
        h('span', { class: 'run-meta' }, where.join(' · ')),
        run.notes && h('span', { class: 'run-notes' }, run.notes),
      ),
    ),
  );
}

function renderTimeline() {
  $('#timeline-empty').hidden = state.runs.length > 0;
  const byWeek = new Map();
  for (const run of S.sortRunsDesc(state.runs).sort((a, b) => b.plan_week - a.plan_week)) {
    if (!byWeek.has(run.plan_week)) byWeek.set(run.plan_week, []);
    byWeek.get(run.plan_week).push(run);
  }
  $('#timeline').replaceChildren(
    ...[...byWeek].map(([week, runs]) => {
      const total = runs.reduce((sum, r) => sum + Number(r.miles), 0);
      return h(
        'li',
        { class: 'timeline-week' },
        h(
          'h3',
          { class: 'timeline-week-title' },
          h('span', {}, `Week ${week} · ${S.formatWeekRange(week)}`),
          h('span', { class: 'timeline-week-total' }, `${S.formatMiles(total, 1)} · ${plural(runs.length, 'run')}`),
        ),
        h('ol', { class: 'timeline-runs' }, runs.map(runItem)),
      );
    }),
  );
}

// ---------- Run log table ----------

// `sort` returns the value a column sorts by; `cell` returns what it shows.
const LOG_COLUMNS = [
  {
    key: 'date',
    label: 'Date',
    sort: (r) => `${r.run_date}-${String(r.plan_day).padStart(2, '0')}`,
    cell: (r) =>
      h(
        'button',
        { type: 'button', class: 'link-btn', onclick: () => openRunDialog(r), 'aria-label': `Edit run on ${S.formatLongDate(r.run_date)}` },
        S.formatShortDate(r.run_date),
      ),
  },
  { key: 'miles', label: 'Miles', numeric: true, sort: (r) => Number(r.miles), cell: (r) => Number(r.miles).toFixed(2) },
  { key: 'time', label: 'Time', numeric: true, sort: (r) => r.duration_seconds, cell: (r) => S.formatDuration(r.duration_seconds) },
  { key: 'pace', label: 'Pace', numeric: true, sort: runPace, cell: (r) => S.formatPace(runPace(r), false) },
  { key: 'type', label: 'Type', sort: (r) => runTypeLabel(r.run_type), cell: (r) => runTypeLabel(r.run_type) },
  {
    key: 'week',
    label: 'Wk·Day',
    numeric: true,
    sort: (r) => r.plan_week * 100 + r.plan_day,
    cell: (r) => `${r.plan_week}·${r.plan_day}`,
  },
  { key: 'temp', label: '°F', numeric: true, sort: (r) => Number(r.temperature_f), cell: (r) => Number(r.temperature_f) },
  { key: 'where', label: 'Where', sort: (r) => r.location, cell: (r) => locationLabel(r.location) },
  { key: 'conditions', label: 'Conditions', journal: true, cell: (r) => r.conditions ?? '' },
  { key: 'food_pre', label: 'Pre-run', journal: true, cell: (r) => r.food_pre ?? '' },
  { key: 'food_during', label: 'During', journal: true, cell: (r) => r.food_during ?? '' },
  { key: 'food_post', label: 'Post-run', journal: true, cell: (r) => r.food_post ?? '' },
  { key: 'notes', label: 'Notes', journal: true, cell: (r) => r.notes ?? '' },
];

function compareRuns(a, b) {
  const column = LOG_COLUMNS.find((c) => c.key === state.sort.key) ?? LOG_COLUMNS[0];
  const x = column.sort(a);
  const y = column.sort(b);
  const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  const tieBreak = LOG_COLUMNS[0].sort(b).localeCompare(LOG_COLUMNS[0].sort(a)); // newest first
  return (state.sort.dir === 'asc' ? order : -order) || tieBreak;
}

function filteredRuns() {
  const { week, type, location } = state.filters;
  return state.runs.filter(
    (r) =>
      (!week || r.plan_week === Number(week)) && (!type || r.run_type === type) && (!location || r.location === location),
  );
}

function setSort(key) {
  const column = LOG_COLUMNS.find((c) => c.key === key);
  if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
  else state.sort = { key, dir: column.numeric || key === 'date' ? 'desc' : 'asc' };
  savePrefs();
  renderLog();
  $(`#log-table th[data-key="${key}"] button`)?.focus();
}

function fillSelect(select, options) {
  const current = select.value;
  select.replaceChildren(...options.map(([value, text]) => h('option', { value }, text)));
  select.value = options.some(([value]) => value === current) ? current : '';
}

function renderFilterOptions() {
  const lastWeek = S.currentPlanWeek(state.runs);
  fillSelect($('#filter-week'), [
    ['', 'All weeks'],
    ...Array.from({ length: lastWeek }, (_, i) => [String(lastWeek - i), `Week ${lastWeek - i}`]),
  ]);
  fillSelect($('#filter-type'), [['', 'All types'], ...RUN_TYPES.map((t) => [t.value, t.label])]);
  fillSelect($('#filter-location'), [['', 'Anywhere'], ...LOCATIONS.map((l) => [l.value, l.label])]);
}

function renderLog() {
  const columns = LOG_COLUMNS.filter((c) => state.showJournal || !c.journal);
  const runs = filteredRuns().sort(compareRuns);
  const filtering = Object.values(state.filters).some(Boolean);
  const totalMiles = runs.reduce((sum, r) => sum + Number(r.miles), 0);

  $('#runs-summary').textContent = `${plural(runs.length, 'run')} · ${S.formatMiles(totalMiles, 1)}${filtering ? ' (filtered)' : ''}`;
  $('#clear-filters').hidden = !filtering;
  $('#show-journal').checked = state.showJournal;

  const table = $('#log-table');
  table.classList.toggle('with-journal', state.showJournal);
  $('thead', table).replaceChildren(
    h(
      'tr',
      {},
      columns.map((c) => {
        if (!c.sort) return h('th', { scope: 'col', class: 'journal' }, c.label);
        const active = state.sort.key === c.key;
        const ariaSort = active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        return h(
          'th',
          { scope: 'col', 'aria-sort': ariaSort, 'data-key': c.key, class: c.numeric ? 'num' : null },
          h(
            'button',
            { type: 'button', class: 'sort-btn', onclick: () => setSort(c.key) },
            c.label,
            h('span', { class: 'sort-icon', 'aria-hidden': 'true' }, active ? (state.sort.dir === 'asc' ? '▲' : '▼') : ''),
          ),
        );
      }),
    ),
  );
  $('tbody', table).replaceChildren(
    ...runs.map((r) =>
      h(
        'tr',
        {},
        columns.map((c) => h('td', { class: c.journal ? 'journal' : c.numeric ? 'num' : null }, c.cell(r))),
      ),
    ),
  );

  $('.log-wrap').hidden = runs.length === 0;
  $('#runs-empty').hidden = runs.length > 0;
  $('#runs-empty').textContent = state.runs.length ? 'No runs match these filters.' : 'Runs you add will show up here.';
  updateScrollHint();
}

// Tells you when columns are off-screen to the right.
function updateScrollHint() {
  const wrap = $('.log-wrap');
  $('#scroll-hint').hidden = wrap.hidden || wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft < 4;
}

// ---------- Weekly summaries ----------

function renderWeekly() {
  const weeks = state.runs.length ? S.summarizeWeeks(state.runs, S.currentPlanWeek(state.runs)) : [];
  $('#weekly-empty').hidden = weeks.length > 0;
  const peak = Math.max(0, ...weeks.map((w) => w.miles));
  const todayWeek = S.planWeekFor(S.todayISO());

  $('#weeks').replaceChildren(
    ...weeks
      .map((week, i) => {
        const previous = weeks[i - 1];
        const title = h(
          'h3',
          {},
          `Week ${week.week} · ${S.formatWeekRange(week.week)}`,
          week.week === todayWeek && h('span', { class: 'tag' }, 'This week'),
        );
        if (!week.runCount) {
          return h('li', { class: 'week week-empty' }, title, h('span', { class: 'sub' }, 'No runs'));
        }
        const share = peak ? (week.miles / peak) * 100 : 0;
        return h(
          'li',
          { class: 'week card' },
          title,
          h('p', { class: 'week-distance' }, S.formatMiles(week.miles, 1)),
          previous && h('p', { class: 'delta' }, deltaText(week.miles, previous.miles, 'the previous week')),
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
            h('div', {}, h('dt', {}, 'Avg pace'), h('dd', {}, S.formatPace(weekPace(week)))),
            h('div', {}, h('dt', {}, 'Longest'), h('dd', {}, S.formatMiles(week.longestMiles, 1))),
          ),
        );
      })
      .reverse(),
  );
}

// ---------- Rendering & routing ----------

function render() {
  if (!state.loaded) return;
  renderDashboard();
  renderTimeline();
  renderFilterOptions();
  renderLog();
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
  updateScrollHint();
}

async function loadRuns() {
  try {
    state.runs = (await runsApi.list()).map((r) => ({ ...r, miles: Number(r.miles), temperature_f: Number(r.temperature_f) }));
    state.loaded = true;
    $('#loading').hidden = true;
    render();
    route();
  } catch (err) {
    if (isAuthError(err)) {
      $('#loading').textContent = 'Locked. Enter your passcode to see your runs.';
      openPasscodeDialog(passcode.get() ? 'That passcode didn’t work. Try again.' : null);
    } else {
      $('#loading').textContent = `Couldn’t load your runs: ${err.message}`;
    }
  }
}

// ---------- Run dialog ----------

const runForm = () => $('#run-form');
const field = (name) => runForm().elements[name];
const auto = { week: false, day: false };

function chipGroup(name, options) {
  return options.map((o) => h('label', { class: 'chip' }, h('input', { type: 'radio', name, value: o.value }), h('span', {}, o.label)));
}

function buildRunForm() {
  $('#type-chips').replaceChildren(...chipGroup('run_type', RUN_TYPES));
  $('#location-chips').replaceChildren(...chipGroup('location', LOCATIONS));
}

function clearFieldErrors() {
  for (const el of $$('.field-error', runForm())) el.textContent = '';
}

function showFieldErrors(errors) {
  for (const [name, message] of Object.entries(errors)) {
    const slot = $(`[data-error-for="${name}"]`, runForm());
    if (slot) slot.textContent = message;
  }
}

function readDuration() {
  return S.toSeconds(field('hours').value, field('minutes').value, field('seconds').value);
}

function updatePacePreview() {
  const seconds = readDuration();
  const miles = Number(field('miles').value);
  $('#pace-preview').textContent = seconds > 0 && miles > 0 ? `Pace ${S.formatPace(S.paceSeconds(seconds, miles))}` : '';
}

// Explains which dates the chosen Week # covers.
function updateWeekHint() {
  const date = field('run_date').value;
  const week = Number(field('plan_week').value);
  const dateWeek = date ? S.planWeekFor(date) : null;
  let hint = '';
  if (date && dateWeek === null) {
    hint = `This date is before Week 1, which starts ${S.formatLongDate(S.planWeekStart(1))}.`;
  } else if (Number.isInteger(week) && week >= 1) {
    hint = `Week ${week} is ${S.formatLongDate(S.planWeekStart(week))} – ${S.formatLongDate(S.addDays(S.planWeekStart(week), 6))}.`;
    if (dateWeek && dateWeek !== week) hint += ` This date is in Week ${dateWeek}.`;
  }
  $('#week-hint').textContent = hint;
}

// Fills Week # and Day # from the date until you type in them yourself.
function autoFillWeekAndDay() {
  const date = field('run_date').value;
  if (auto.week) field('plan_week').value = (date && S.planWeekFor(date)) || '';
  const week = Number(field('plan_week').value);
  if (auto.day) field('plan_day').value = week >= 1 && date ? S.nextPlanDay(state.runs, week, date, state.editingId) : '';
  updateWeekHint();
}

function openRunDialog(run = null) {
  const form = runForm();
  form.reset();
  clearFieldErrors();
  state.editingId = run?.id ?? null;
  auto.week = !run;
  auto.day = !run;

  $('#run-dialog-title').textContent = run ? 'Edit run' : 'Add a run';
  $('#delete-run').hidden = !run;

  field('run_date').value = run?.run_date ?? S.todayISO();
  field('plan_week').value = run?.plan_week ?? '';
  field('plan_day').value = run?.plan_day ?? '';
  field('miles').value = run ? Number(run.miles).toFixed(2) : '';
  const parts = run ? S.splitSeconds(run.duration_seconds) : null;
  field('hours').value = parts ? parts.hours : '';
  field('minutes').value = parts ? String(parts.minutes).padStart(2, '0') : '';
  field('seconds').value = parts ? String(parts.seconds).padStart(2, '0') : '';
  field('run_type').value = run?.run_type ?? 'easy';
  field('location').value = run?.location ?? 'outside';
  field('temperature_f').value = run?.temperature_f ?? '';
  field('conditions').value = run?.conditions ?? '';
  field('food_pre').value = run?.food_pre ?? '';
  field('food_during').value = run?.food_during ?? '';
  field('food_post').value = run?.food_post ?? '';
  field('notes').value = run?.notes ?? '';

  autoFillWeekAndDay();
  updatePacePreview();
  $('#run-dialog').showModal();
  if (!run) field('miles').focus();
}

async function saveRun(event) {
  event.preventDefault();
  clearFieldErrors();

  const { value, errors } = validateRun({
    run_date: field('run_date').value,
    plan_week: field('plan_week').value,
    plan_day: field('plan_day').value,
    miles: field('miles').value,
    duration_seconds: readDuration(),
    temperature_f: field('temperature_f').value,
    conditions: field('conditions').value,
    location: field('location').value,
    run_type: field('run_type').value,
    food_pre: field('food_pre').value,
    food_during: field('food_during').value,
    food_post: field('food_post').value,
    notes: field('notes').value,
  });
  if (errors) {
    showFieldErrors(errors);
    $('.field-error:not(:empty)', runForm())?.closest('.field')?.querySelector('input, textarea, select')?.focus();
    return;
  }

  const submit = $('button[type="submit"]', runForm());
  submit.disabled = true;
  try {
    const saved = state.editingId ? await runsApi.update(state.editingId, value) : await runsApi.create(value);
    const run = { ...saved, miles: Number(saved.miles), temperature_f: Number(saved.temperature_f) };
    state.runs = state.editingId ? state.runs.map((r) => (r.id === run.id ? run : r)) : [...state.runs, run];
    $('#run-dialog').close();
    render();
    toast(state.editingId ? 'Run updated' : 'Run saved');
  } catch (err) {
    if (isAuthError(err)) openPasscodeDialog('Enter your passcode, then save again.');
    else if (err instanceof ApiError && err.fields) showFieldErrors(err.fields);
    else showFieldErrors({ form: `Couldn’t save: ${err.message}` });
  } finally {
    submit.disabled = false;
  }
}

async function deleteRun() {
  if (!state.editingId || !confirm('Delete this run? This can’t be undone.')) return;
  try {
    await runsApi.remove(state.editingId);
    state.runs = state.runs.filter((r) => r.id !== state.editingId);
    $('#run-dialog').close();
    render();
    toast('Run deleted');
  } catch (err) {
    if (isAuthError(err)) openPasscodeDialog('Enter your passcode, then try again.');
    else showFieldErrors({ form: `Couldn’t delete: ${err.message}` });
  }
}

// ---------- Passcode ----------

function openPasscodeDialog(message) {
  const dialog = $('#passcode-dialog');
  if (message) $('#passcode-message').textContent = message;
  if (!dialog.open) dialog.showModal();
  $('#passcode-input').focus();
}

// ---------- Setup ----------

function wireEvents() {
  window.addEventListener('hashchange', route);
  for (const el of $$('[data-open-log]')) el.addEventListener('click', () => openRunDialog());
  for (const el of $$('[data-close]')) el.addEventListener('click', () => el.closest('dialog').close());

  const form = runForm();
  form.addEventListener('submit', saveRun);
  form.addEventListener('input', (event) => {
    const name = event.target.name;
    if (name === 'plan_week') auto.week = false;
    if (name === 'plan_day') auto.day = false;
    if (name === 'run_date' || name === 'plan_week') autoFillWeekAndDay();
    clearFieldErrors();
    updatePacePreview();
  });
  $('#delete-run').addEventListener('click', deleteRun);

  // Tapping the backdrop closes the run sheet.
  $('#run-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  const filters = { 'filter-week': 'week', 'filter-type': 'type', 'filter-location': 'location' };
  for (const [id, key] of Object.entries(filters)) {
    $(`#${id}`).addEventListener('change', (event) => {
      state.filters[key] = event.target.value;
      renderLog();
    });
  }
  $('#clear-filters').addEventListener('click', () => {
    state.filters = { week: '', type: '', location: '' };
    for (const id of Object.keys(filters)) $(`#${id}`).value = '';
    renderLog();
  });
  $('.log-wrap').addEventListener('scroll', updateScrollHint, { passive: true });
  window.addEventListener('resize', updateScrollHint);
  $('#show-journal').addEventListener('change', (event) => {
    state.showJournal = event.target.checked;
    savePrefs();
    renderLog();
  });

  $('#passcode-form').addEventListener('submit', (event) => {
    event.preventDefault();
    passcode.set($('#passcode-input').value);
    $('#passcode-dialog').close();
    $('#passcode-input').value = '';
    loadRuns();
  });
}

async function init() {
  buildRunForm();
  wireEvents();
  if (!(await isConfigured())) {
    $('#loading').hidden = true;
    $('#setup').hidden = false;
    document.body.classList.add('needs-setup');
    return;
  }
  await loadRuns();
}

init();
