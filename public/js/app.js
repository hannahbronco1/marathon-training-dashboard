import { ApiError, fetchConfig, passcode, runsApi, sendChat, targetsApi } from './store.js';
import { renderChart } from './charts.js';
import { LOCATIONS, RUN_TYPES, locationLabel, runTypeLabel, validateRun, validateTarget } from './run-schema.js';
import { PLAN } from './plan.js';
import * as Backup from './backup.js';
import * as S from './stats.js';

const VIEWS = ['dashboard', 'timeline', 'runs', 'weekly', 'chat'];
const MAX_CHAT_MESSAGES = 40; // the server's limit
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
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ sort: state.sort, showJournal: state.showJournal, chatIncludeRuns: chatState.includeRuns }),
    );
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
  scrollToWeek: null,
  // Weekly mileage targets: plan week -> miles. `targetsStatus` is 'ok',
  // 'needs-setup' (the week_targets table isn't in Supabase yet) or 'error'.
  targets: new Map(),
  targetsStatus: 'ok',
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
  $('.chart-table', card).hidden = table.rows.length === 0;
}

// A chart frame that says "No runs yet" until there's something to plot.
function renderEmptyChart(id) {
  renderChartCard(id, { kind: 'line', points: [], ariaLabel: 'No runs yet' }, { headers: [], rows: [] });
}

const compactNumber = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const paceTick = (s) => S.formatPace(s, false);
const weekTitle = (w) => `Week ${w.week} · ${S.formatWeekRange(w.week)}`;

// The race bib counts down to race day. It doesn't depend on any runs.
function renderBib() {
  const { days, week, totalWeeks } = S.raceCountdown();
  $('#bib-label').textContent =
    days > 1 ? 'Days to the start line' : days === 1 ? 'Day to the start line' : days === 0 ? 'Race day' : 'Finish line crossed';
  $('#bib-number').textContent = days > 0 ? days : '26.2';
  $('#bib-date').textContent = S.formatBibDate(PLAN.raceDate);
  const pad = (n) => String(n).padStart(2, '0');
  $('#bib-week').textContent =
    week === null ? `Starts ${S.formatBibDate(S.planWeekStart(1))}` : `Week ${pad(Math.min(week, totalWeeks))} / ${totalWeeks}`;
}

// The whole dashboard shows from day one; with no runs yet the numbers
// read zero, the strip shows the plan's weeks and charts say "No runs yet".
function renderDashboard() {
  $('#dashboard-empty').hidden = state.runs.length > 0;

  // Plan totals.
  const totals = S.planTotals(state.runs);
  $('#tile-total').textContent = totals.miles.toFixed(1);
  $('#tile-pace').textContent = totals.runCount ? S.formatPace(S.paceSeconds(totals.durationSeconds, totals.miles), false) : '--';
  const longest = totals.longest;
  const longestButton = $('#tile-longest');
  longestButton.textContent = longest ? Number(longest.miles).toFixed(1) : '--';
  longestButton.disabled = !longest;
  if (longest) longestButton.setAttribute('aria-label', `Longest run: ${S.formatMiles(longest.miles)} on ${S.formatLongDate(longest.run_date)}. Open it.`);
  else longestButton.removeAttribute('aria-label');
  longestButton.onclick = longest ? () => openRunDialog(longest) : null;
  $('#tile-longest-date').textContent = longest ? S.formatShortDate(longest.run_date) : '';

  renderWeeksStrip();
  renderMilesOverTime();
  renderTempVsPace();
}

const targetsOn = () => state.targetsStatus === 'ok';

// Share of a week's target done, 0–100, for progress bars.
const targetShare = (miles, target) => Math.min(100, (miles / target) * 100);

function chipMeter(miles, target) {
  return h('span', { class: 'chip-meter', 'aria-hidden': 'true' }, h('span', { style: `width: ${targetShare(miles, target).toFixed(1)}%` }));
}

// One card per plan week, Week 1 to race week. Future weeks are dashed.
// Tapping a past week opens its Weekly card; tapping a future week sets
// its target.
function renderWeeksStrip() {
  const { totalWeeks } = S.raceCountdown();
  const todayWeek = S.planWeekFor(S.todayISO());
  const weeks = S.summarizeWeeks(state.runs, Math.max(totalWeeks, S.currentPlanWeek(state.runs)));

  $('#weeks-strip').replaceChildren(
    ...weeks.map((w) => {
      const isNow = w.week === todayWeek;
      const isFuture = !w.runCount && (todayWeek === null || w.week > todayWeek);
      const target = state.targets.get(w.week);
      const targetText = target ? `, target ${S.shortMiles(target)} miles` : '';
      const code = h('span', { class: 'chip-code' }, S.weekCode(w.week), isNow && ' · Now');
      const value = (text) => h('span', { class: 'chip-value' }, text, target && h('small', {}, `/${S.shortMiles(target)}`));

      if (isFuture) {
        const when = w.week === totalWeeks ? 'Race week' : S.formatShortDate(S.planWeekStart(w.week));
        const parts = [code, value('--'), h('span', { class: 'chip-sub' }, when)];
        if (!targetsOn()) {
          return h('li', {}, h('div', { class: 'week-chip is-future', 'aria-label': `Week ${w.week}, starts ${S.formatLongDate(S.planWeekStart(w.week))}${targetText}` }, ...parts));
        }
        return h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'week-chip is-future',
              'aria-label': `Week ${w.week}, starts ${S.formatLongDate(S.planWeekStart(w.week))}${targetText}. ${target ? 'Change' : 'Set'} its target.`,
              onclick: () => openTargetDialog(w.week),
            },
            ...parts,
          ),
        );
      }
      return h(
        'li',
        {},
        h(
          'a',
          {
            href: '#weekly',
            class: `week-chip${isNow ? ' is-now' : ''}`,
            'aria-label': `Week ${w.week}, ${S.formatWeekRange(w.week)}: ${w.miles.toFixed(1)} miles${targetText}, ${plural(w.runCount, 'run')}${isNow ? ', this week' : ''}. Open weekly summary.`,
            onclick: () => (state.scrollToWeek = w.week),
          },
          code,
          value(w.miles.toFixed(1)),
          h('span', { class: 'chip-sub' }, plural(w.runCount, 'run')),
          target && chipMeter(w.miles, target),
        ),
      );
    }),
  );

  renderTargetsMeta();

  // A line about the current week under the strip.
  const upTo = S.summarizeWeeks(state.runs, S.currentPlanWeek(state.runs));
  const thisWeek = upTo.at(-1);
  const lastWeek = upTo.at(-2);
  const comparison = !lastWeek
    ? 'Week 1 of your plan'
    : thisWeek.miles
      ? deltaText(thisWeek.miles, lastWeek.miles, 'last week')
      : `Last week: ${S.formatMiles(lastWeek.miles, 1)}`;
  const parts = [plural(thisWeek.runCount, 'run'), S.formatHours(thisWeek.durationSeconds)];
  if (thisWeek.runCount) parts.push(S.formatPace(weekPace(thisWeek)));
  const thisTarget = state.targets.get(thisWeek.week);
  if (thisTarget) parts.push(`${thisWeek.miles.toFixed(1)} of ${S.shortMiles(thisTarget)} mi target`);
  parts.push(comparison);
  if (!state.runs.length) parts.splice(0, parts.length, thisTarget ? `nothing logged yet · ${S.shortMiles(thisTarget)} mi target` : 'nothing logged yet');
  $('#hero-delta').textContent = `${thisWeek.week === todayWeek ? 'This week' : `Week ${thisWeek.week}`}: ${parts.join(' · ')}`;
  scrollStripToNow();
}

// The line beside "Weeks": an Add link, an Edit link, or a setup note.
function renderTargetsMeta() {
  const meta = $('#weeks-meta');
  if (state.targetsStatus === 'needs-setup') {
    meta.replaceChildren('Targets need a database update');
    return;
  }
  if (state.targetsStatus === 'error') {
    meta.replaceChildren('Targets unavailable');
    return;
  }
  const open = () => openTargetDialog(S.planWeekFor(S.todayISO()) ?? 1);
  meta.replaceChildren(
    ...(state.targets.size
      ? [h('button', { type: 'button', class: 'link-btn', onclick: open }, 'Edit targets')]
      : ['No weekly targets yet · ', h('button', { type: 'button', class: 'link-btn', onclick: open, 'aria-label': 'Add a weekly target' }, 'Add')]),
  );
}

// Brings the current week's card into view without moving the page.
function scrollStripToNow() {
  const strip = $('#weeks-strip');
  const now = $('.week-chip.is-now', strip)?.parentElement;
  if (!strip.clientWidth || !now) return;
  strip.scrollLeft = Math.max(0, now.offsetLeft - strip.offsetLeft - (strip.clientWidth - now.offsetWidth) / 2);
}

function renderMilesOverTime() {
  const series = S.cumulativeMiles(state.runs);
  if (!series.length) return renderEmptyChart('chart-total');
  const time = (iso) => S.parseDate(iso).getTime();
  const today = S.todayISO();
  const first = series[0].date;
  const last = series.at(-1).date;
  const end = today > last ? today : last;

  const ticks = [{ x: time(first), label: S.formatShortDate(first) }];
  if (last !== first) ticks.push({ x: time(last), label: S.formatShortDate(last) });
  if (end === today && today !== last) ticks.push({ x: time(today), label: 'Today' });

  renderChartCard(
    'chart-total',
    {
      kind: 'line',
      ariaLabel: 'Running total of miles since your first run',
      yFormat: compactNumber,
      valueFormat: (v) => v.toFixed(1),
      xDomain: [time(first), time(end)],
      xTicks: ticks,
      carryTo: end === today ? time(today) : null,
      points: series.map((p) => ({
        x: time(p.date),
        label: S.formatShortDate(p.date),
        value: p.total,
        tooltip: { value: `${S.shortMiles(p.total)} mi total`, title: S.formatLongDate(p.date), detail: `+${S.shortMiles(p.dayMiles)} mi that day` },
      })),
    },
    {
      headers: ['Date', 'Miles that day', 'Running total'],
      rows: [...series].reverse().map((p) => [S.formatShortDate(p.date), p.dayMiles.toFixed(2), p.total.toFixed(2)]),
    },
  );
}

function renderTempVsPace() {
  const runs = S.sortRunsDesc(state.runs);
  if (!runs.length) return renderEmptyChart('chart-temp');
  const maxMiles = Math.max(...runs.map((r) => Number(r.miles)));
  const { longest } = S.planTotals(runs);
  // With a handful of runs every dot gets a label, as in the design; after
  // that only the longest does, and the tooltip and table carry the rest.
  const labelAll = runs.length <= 5;

  renderChartCard(
    'chart-temp',
    {
      kind: 'scatter',
      ariaLabel: 'Pace of each run by temperature; bigger dots are longer runs',
      yZero: false,
      yTime: true,
      yInvert: true,
      yFormat: paceTick,
      xFormat: (v) => `${v}°`,
      xIntegers: true,
      points: runs.map((r) => ({
        x: Number(r.temperature_f),
        value: runPace(r),
        size: Number(r.miles) / maxMiles,
        directLabel: labelAll || r === longest ? `${S.shortMiles(r.miles)} mi` : null,
        label: S.formatShortDate(r.run_date),
        tooltip: {
          value: S.formatPace(runPace(r)),
          title: `${S.formatLongDate(r.run_date)} · ${runTypeLabel(r.run_type)}`,
          detail: `${S.shortMiles(r.miles)} mi · ${[S.formatTemperature(r.temperature_f), r.conditions].filter(Boolean).join(' ')}`,
        },
      })),
    },
    {
      headers: ['Date', '°F', 'Pace (/mi)', 'Miles'],
      rows: runs.map((r) => [S.formatShortDate(r.run_date), Number(r.temperature_f), paceTick(runPace(r)), Number(r.miles).toFixed(2)]),
    },
  );
}

// The week-by-week charts at the top of the Weekly tab.
function renderWeeklyCharts(weeks) {
  const label = (w) => S.weekCode(w.week);
  const newestFirst = [...weeks].reverse();

  const hasTargets = weeks.some((w) => state.targets.has(w.week));
  $('#chart-weekly .sub').textContent = hasTargets ? 'Miles per plan week · the white line marks your target' : 'Miles per plan week';
  renderChartCard(
    'chart-weekly',
    {
      kind: 'column',
      ariaLabel: hasTargets ? 'Miles per plan week, with your weekly targets' : 'Miles per plan week',
      yFormat: compactNumber,
      valueFormat: (v) => v.toFixed(1),
      points: weeks.map((w) => {
        const target = state.targets.get(w.week);
        const runs = plural(w.runCount, 'run');
        return {
          label: label(w),
          value: w.miles,
          target,
          tooltip: { value: S.formatMiles(w.miles, 1), title: weekTitle(w), detail: target ? `${runs} · target ${S.shortMiles(target)} mi` : runs },
        };
      }),
    },
    {
      headers: hasTargets ? ['Week', 'Miles', 'Target', 'Runs'] : ['Week', 'Miles', 'Runs'],
      rows: newestFirst.map((w) => {
        const target = state.targets.get(w.week);
        const row = [`Week ${w.week}`, w.miles.toFixed(2)];
        if (hasTargets) row.push(target ? target.toFixed(2) : '–');
        row.push(w.runCount);
        return row;
      }),
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
      yTime: true,
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

// How each run type's tag is drawn (the tag always shows the type's name).
const TAG_STYLES = { long: 'filled', race: 'filled', easy: 'outline', tempo: 'outline', other: 'dashed' };

function runItem(run, isLatest) {
  const where = [S.formatTemperature(run.temperature_f), run.conditions, locationLabel(run.location)].filter(Boolean);
  const food = [
    ['Pre', run.food_pre],
    ['During', run.food_during],
    ['Post', run.food_post],
  ].filter(([, text]) => text);
  return h(
    'li',
    { class: `run${isLatest ? ' is-latest' : ''}` },
    h('span', { class: 'run-dot', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'run-head' },
      h(
        'h4',
        { class: 'run-title' },
        // The title's button covers the whole entry, so tapping anywhere edits it.
        h(
          'button',
          { type: 'button', class: 'run-open', onclick: () => openRunDialog(run) },
          `${S.formatLongDate(run.run_date)} · Run ${run.plan_day}`,
        ),
      ),
      h('span', { class: `tag tag-${TAG_STYLES[run.run_type] ?? 'outline'}` }, runTypeLabel(run.run_type)),
    ),
    h(
      'p',
      { class: 'run-stats' },
      h('span', { class: 'run-miles' }, S.shortMiles(run.miles), h('small', {}, ' mi')),
      h('span', {}, S.formatDuration(run.duration_seconds)),
      h('span', {}, S.formatPace(runPace(run))),
    ),
    h('p', { class: 'run-where' }, where.join(' · ')),
    food.length > 0 &&
      h(
        'dl',
        { class: 'food' },
        food.map(([label, text]) => h('div', {}, h('dt', {}, label), h('dd', {}, text))),
      ),
    run.notes && h('p', { class: 'run-notes' }, run.notes),
  );
}

function renderTimeline() {
  $('#timeline-empty').hidden = state.runs.length > 0;
  const byWeek = new Map();
  for (const run of S.sortRunsDesc(state.runs).sort((a, b) => b.plan_week - a.plan_week)) {
    if (!byWeek.has(run.plan_week)) byWeek.set(run.plan_week, []);
    byWeek.get(run.plan_week).push(run);
  }
  const latest = byWeek.values().next().value?.[0];
  $('#timeline').replaceChildren(
    ...[...byWeek].map(([week, runs]) => {
      const total = runs.reduce((sum, r) => sum + Number(r.miles), 0);
      return h(
        'li',
        { class: 'timeline-week' },
        h(
          'h3',
          { class: 'timeline-week-title' },
          h('span', {}, `Week ${String(week).padStart(2, '0')} · ${S.formatWeekRange(week)}`),
          h('span', { class: 'timeline-week-total' }, `${S.shortMiles(total)} mi · ${plural(runs.length, 'run')}`),
        ),
        h('ol', { class: 'timeline-runs' }, runs.map((run) => runItem(run, run === latest))),
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
  $('#weekly-charts').hidden = weeks.length === 0;
  if (weeks.length) renderWeeklyCharts(weeks);
  const peak = Math.max(0, ...weeks.map((w) => w.miles));
  const todayWeek = S.planWeekFor(S.todayISO());

  $('#weeks').replaceChildren(
    ...weeks
      .map((week, i) => {
        const previous = weeks[i - 1];
        const isNow = week.week === todayWeek;
        const target = state.targets.get(week.week);
        const title = h(
          'h3',
          {},
          `${S.weekCode(week.week)} · ${S.formatWeekRange(week.week)}`,
          isNow && h('span', { class: 'tag tag-filled' }, 'Now'),
        );
        const targetButton =
          targetsOn() &&
          h(
            'button',
            { type: 'button', class: 'link-btn week-target-btn', onclick: () => openTargetDialog(week.week), 'aria-label': `${target ? 'Edit' : 'Set'} the Week ${week.week} target` },
            target ? 'Edit target' : 'Set target',
          );
        const head = h('div', { class: 'week-head' }, title, targetButton);
        if (!week.runCount) {
          return h(
            'li',
            { id: `week-${week.week}`, class: `week week-empty${isNow ? ' is-now' : ''}` },
            head,
            h('span', { class: 'sub' }, target ? `No runs · ${S.shortMiles(target)} mi target` : 'No runs'),
          );
        }
        // With a target the bar shows progress toward it; otherwise it
        // compares the week with your biggest week.
        const share = target ? targetShare(week.miles, target) : peak ? (week.miles / peak) * 100 : 0;
        const meterLabel = target
          ? `${Math.round((week.miles / target) * 100)}% of your ${S.shortMiles(target)} mi target`
          : `${Math.round(share)}% of your biggest week`;
        return h(
          'li',
          { id: `week-${week.week}`, class: `week card${isNow ? ' is-now' : ''}` },
          head,
          h('p', { class: 'week-distance' }, S.shortMiles(week.miles), h('small', {}, target ? ` / ${S.shortMiles(target)} mi` : ' mi')),
          target && h('p', { class: 'week-target' }, meterLabel),
          previous && h('p', { class: 'delta' }, deltaText(week.miles, previous.miles, 'the previous week')),
          h('div', { class: `meter${target ? ' is-target' : ''}`, role: 'img', 'aria-label': meterLabel }, h('span', { style: `width: ${share.toFixed(1)}%` })),
          h(
            'dl',
            { class: 'tiles' },
            h('div', {}, h('dt', {}, 'Runs'), h('dd', {}, week.runCount)),
            h('div', {}, h('dt', {}, 'Time'), h('dd', {}, S.formatHours(week.durationSeconds))),
            h('div', {}, h('dt', {}, 'Avg /mi'), h('dd', {}, S.formatPace(weekPace(week), false))),
            h('div', {}, h('dt', {}, 'Longest'), h('dd', {}, `${S.shortMiles(week.longestMiles)} mi`)),
          ),
        );
      })
      .reverse(),
  );
}

// ---------- Rendering & routing ----------

function render() {
  if (!state.loaded) return;
  renderBib();
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
  if (view === 'dashboard') scrollStripToNow();
  // Tapping a week in the dashboard strip opens its weekly summary.
  if (view === 'weekly' && state.scrollToWeek) {
    document.getElementById(`week-${state.scrollToWeek}`)?.scrollIntoView({ block: 'start' });
  }
  state.scrollToWeek = null;
}

// Targets are optional: if they can't load, the rest of the site still works.
async function loadTargets() {
  try {
    const list = await targetsApi.list();
    state.targets = new Map(list.map((t) => [t.plan_week, Number(t.target_miles)]));
    state.targetsStatus = 'ok';
  } catch (err) {
    if (isAuthError(err)) throw err;
    state.targets = new Map();
    // A 404 from Supabase means the week_targets table hasn't been created.
    state.targetsStatus = /\(404\)/.test(err.message) ? 'needs-setup' : 'error';
    console.warn('Weekly targets unavailable:', err.message);
  }
}

async function loadRuns() {
  try {
    const [runs] = await Promise.all([runsApi.list(), loadTargets()]);
    state.runs = runs.map((r) => ({ ...r, miles: Number(r.miles), temperature_f: Number(r.temperature_f) }));
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

// ---------- Backup & import ----------

const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  downloadFile(Backup.exportFileName('csv'), Backup.runsToCSV(state.runs), 'text/csv;charset=utf-8');
  toast(`Downloaded ${plural(state.runs.length, 'run')}`);
}

function exportJSON() {
  downloadFile(Backup.exportFileName('json'), Backup.backupJSON(state.runs, state.targets), 'application/json');
  toast('Backup downloaded');
}

// What the chosen file would add, waiting for "Import" to be tapped.
let pendingImport = null;

async function readChosenFile(event) {
  const file = event.target.files[0];
  event.target.value = ''; // so choosing the same file again still works
  if (!file) return;
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    toast('That file is too big to import (2 MB max).');
    return;
  }
  pendingImport = Backup.readImportFile(file.name, await file.text(), state.runs);
  showImportPreview(file.name, pendingImport);
}

function showImportPreview(name, plan) {
  const form = $('#import-form');
  $('[data-error-for="form"]', form).textContent = '';
  $('#import-file-name').textContent = name;
  const rows = [
    ['New runs', plan.toAdd.length],
    ['Already in your log (skipped)', plan.duplicates],
  ];
  if (plan.targets.length) rows.push(['Weekly targets', plan.targets.length]);
  if (plan.problems.length) rows.push(['Can’t import', plan.problems.length]);
  $('#import-summary').replaceChildren(...rows.map(([label, n]) => h('div', {}, h('dt', {}, label), h('dd', {}, n))));

  const problems = $('#import-problems');
  problems.hidden = plan.problems.length === 0;
  const shown = plan.problems.slice(0, 8);
  const items = shown.map((p) => h('li', {}, p));
  if (plan.problems.length > shown.length) items.push(h('li', {}, `…and ${plan.problems.length - shown.length} more`));
  $('ul', problems).replaceChildren(...items);

  const notes = [];
  if (plan.targets.length) notes.push('Targets in this file replace any you’ve set for the same weeks.');
  if (plan.toAdd.length) notes.push('Food and notes are imported exactly as written.');
  $('#import-note').textContent = notes.join(' ');

  const nothing = !plan.toAdd.length && !plan.targets.length;
  const confirm = $('#import-confirm');
  confirm.disabled = nothing;
  confirm.textContent = nothing
    ? 'Nothing to import'
    : plan.toAdd.length
      ? `Import ${plural(plan.toAdd.length, 'run')}`
      : `Import ${plural(plan.targets.length, 'target')}`;
  $('#import-dialog').showModal();
}

async function confirmImport(event) {
  event.preventDefault();
  if (!pendingImport) return;
  const form = $('#import-form');
  const confirm = $('#import-confirm');
  confirm.disabled = true;
  confirm.textContent = 'Importing…';
  try {
    const { imported, skipped } = await runsApi.importMany(pendingImport.toAdd);
    for (const t of pendingImport.targets) await targetsApi.set(t.plan_week, t.target_miles);
    const already = skipped + pendingImport.duplicates;
    const targetCount = pendingImport.targets.length;
    const parts = [];
    if (imported || !targetCount) parts.push(`Imported ${plural(imported, 'run')}`);
    if (targetCount) parts.push(`${parts.length ? '' : 'Imported '}${plural(targetCount, 'target')}`);
    if (already) parts.push(`${already} already in your log`);
    pendingImport = null;
    await loadRuns(); // refresh everything before closing, so the new numbers are there
    $('#import-dialog').close();
    toast(parts.join(' · '));
  } catch (err) {
    confirm.disabled = false;
    confirm.textContent = 'Try again';
    if (isAuthError(err)) openPasscodeDialog('Enter your passcode, then import again.');
    else $('[data-error-for="form"]', form).textContent = `Couldn’t import: ${err.message}`;
  }
}

// ---------- Target dialog ----------

const targetForm = () => $('#target-form');

function clearTargetErrors() {
  for (const el of $$('.field-error', targetForm())) el.textContent = '';
}

// Shows the chosen week's dates, miles so far and existing target. The
// miles box only ever holds a number the runner typed or saved before.
function syncTargetForm() {
  const week = Number(targetForm().elements.plan_week.value);
  const target = state.targets.get(week);
  const logged = state.runs.filter((r) => r.plan_week === week).reduce((sum, r) => sum + Number(r.miles), 0);
  targetForm().elements.target_miles.value = target ?? '';
  $('#target-remove').hidden = !target;
  $('#target-hint').textContent = `Week ${week} is ${S.formatLongDate(S.planWeekStart(week))} – ${S.formatLongDate(S.addDays(S.planWeekStart(week), 6))}. Logged so far: ${S.shortMiles(logged)} mi.`;
}

function openTargetDialog(week) {
  const { totalWeeks } = S.raceCountdown();
  const lastWeek = Math.max(totalWeeks, S.currentPlanWeek(state.runs));
  $('#target-week').replaceChildren(
    ...Array.from({ length: lastWeek }, (_, i) => {
      const n = i + 1;
      const target = state.targets.get(n);
      return h('option', { value: n }, `Week ${n} · ${S.formatWeekRange(n)}${target ? ` · ${S.shortMiles(target)} mi` : ''}`);
    }),
  );
  $('#target-week').value = String(Math.min(Math.max(week, 1), lastWeek));
  clearTargetErrors();
  syncTargetForm();
  $('#target-dialog').showModal();
  targetForm().elements.target_miles.focus();
}

async function saveTarget(event) {
  event.preventDefault();
  clearTargetErrors();
  const form = targetForm();
  const { value, errors } = validateTarget({ plan_week: form.elements.plan_week.value, target_miles: form.elements.target_miles.value });
  if (errors) {
    for (const [name, message] of Object.entries(errors)) $(`[data-error-for="${name}"]`, form).textContent = message;
    form.elements.target_miles.focus();
    return;
  }
  const submit = $('button[type="submit"]', form);
  submit.disabled = true;
  try {
    const saved = await targetsApi.set(value.plan_week, value.target_miles);
    state.targets.set(saved.plan_week, Number(saved.target_miles));
    $('#target-dialog').close();
    render();
    toast(`Week ${value.plan_week} target saved`);
  } catch (err) {
    if (isAuthError(err)) openPasscodeDialog('Enter your passcode, then save again.');
    else if (err instanceof ApiError && err.fields) {
      for (const [name, message] of Object.entries(err.fields)) {
        const slot = $(`[data-error-for="${name}"]`, form);
        if (slot) slot.textContent = message;
      }
    } else $('[data-error-for="form"]', form).textContent = `Couldn’t save: ${err.message}`;
  } finally {
    submit.disabled = false;
  }
}

async function removeTarget() {
  const week = Number(targetForm().elements.plan_week.value);
  try {
    await targetsApi.remove(week);
    state.targets.delete(week);
    $('#target-dialog').close();
    render();
    toast(`Week ${week} target removed`);
  } catch (err) {
    if (isAuthError(err)) openPasscodeDialog('Enter your passcode, then try again.');
    else $('[data-error-for="form"]', targetForm()).textContent = `Couldn’t remove: ${err.message}`;
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

// ---------- Chat (test) ----------

// Explains why chat is off, using the secret names the Worker reports.
function showChatStatus(config) {
  $('#chat-off').hidden = config.chat !== false;
  if (config.chat !== false) return;
  const seen = config.nvidiaSecretsSeen ?? [];
  const exact = seen.find((s) => s.name === 'NVIDIA_API_KEY');
  let detail;
  if (exact?.empty) {
    detail = 'The site sees NVIDIA_API_KEY, but its value is empty. Delete it and add it again with your key pasted in.';
  } else if (seen.length) {
    const names = seen.map((s) => `“${s.name}”`).join(', ');
    detail = `The site sees ${names}, which isn’t exactly NVIDIA_API_KEY (check capitals and spaces).`;
  } else {
    detail =
      'The site doesn’t see any NVIDIA secret. Check it’s under Settings → Variables and Secrets (not Build), and that the change was saved or deployed.';
  }
  $('#chat-off-detail').textContent = detail;
}

// The conversation lives only in this page; reloading starts fresh.
// Each assistant message may carry `runsUsed`, how many runs it was given.
const chatState = { messages: [], sending: false, includeRuns: prefs.chatIncludeRuns !== false };

function chatBubble(role, text, extraClass = '', runsUsed) {
  return h(
    'li',
    { class: `bubble bubble-${role} ${extraClass}`.trim() },
    h('span', { class: 'bubble-who' }, role === 'user' ? 'You' : 'Nemotron'),
    h('p', { class: 'bubble-text' }, text),
    runsUsed !== undefined && h('span', { class: 'bubble-meta' }, `Based on your ${plural(runsUsed, 'run')}`),
  );
}

function renderChatPrivacy() {
  $('#chat-include-runs').checked = chatState.includeRuns;
  $('#chat-privacy').textContent = chatState.includeRuns
    ? 'Chat with NVIDIA Nemotron 3.5 Lightning about your runs. Each message sends your run log (dates, miles, times, paces, weather, run types) to NVIDIA. Your food and notes are never sent. Check anything important against your Log.'
    : 'Chat with NVIDIA Nemotron 3.5 Lightning. It can’t see your runs, food or notes.';
}

function renderChat() {
  renderChatPrivacy();
  const log = $('#chat-log');
  log.replaceChildren(...chatState.messages.map((m) => chatBubble(m.role, m.content, '', m.runsUsed)));
  if (chatState.sending) log.append(chatBubble('assistant', 'Thinking…', 'is-pending'));
  $('#chat-clear').hidden = chatState.messages.length === 0 || chatState.sending;
  $('#chat-form button').disabled = chatState.sending;
  log.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

async function sendChatMessage(event) {
  event.preventDefault();
  const input = $('#chat-input');
  const text = input.value;
  if (!text.trim() || chatState.sending) return;

  $('#chat-error').textContent = '';
  chatState.messages.push({ role: 'user', content: text });
  chatState.sending = true;
  input.value = '';
  renderChat();
  try {
    // Only role and content go to the server; runsUsed stays on this page.
    const history = chatState.messages.slice(-MAX_CHAT_MESSAGES).map(({ role, content }) => ({ role, content }));
    const { reply, finish_reason, runs_used } = await sendChat(history, { includeRuns: chatState.includeRuns });
    const content = reply || (finish_reason === 'length' ? '(The reply ran out of room before finishing.)' : '(No reply.)');
    chatState.messages.push({ role: 'assistant', content, runsUsed: runs_used });
  } catch (err) {
    // Put the message back so it can be sent again.
    chatState.messages.pop();
    input.value = text;
    if (isAuthError(err)) openPasscodeDialog('Enter your passcode, then send again.');
    else $('#chat-error').textContent = err.message;
  } finally {
    chatState.sending = false;
    renderChat();
  }
}

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

  $('#chat-form').addEventListener('submit', sendChatMessage);
  $('#chat-include-runs').addEventListener('change', (event) => {
    chatState.includeRuns = event.target.checked;
    savePrefs();
    renderChatPrivacy();
  });
  // Ctrl/Cmd + Enter sends; Enter alone adds a new line.
  $('#chat-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('#chat-form').requestSubmit();
  });
  $('#chat-clear').addEventListener('click', () => {
    chatState.messages = [];
    $('#chat-error').textContent = '';
    renderChat();
    $('#chat-input').focus();
  });

  $('#export-csv').addEventListener('click', exportCSV);
  $('#export-json').addEventListener('click', exportJSON);
  $('#export-template').addEventListener('click', () => downloadFile('marathon-runs-template.csv', Backup.csvTemplate(), 'text/csv;charset=utf-8'));
  $('#import-open').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', readChosenFile);
  $('#import-form').addEventListener('submit', confirmImport);

  targetForm().addEventListener('submit', saveTarget);
  $('#target-week').addEventListener('change', () => {
    clearTargetErrors();
    syncTargetForm();
  });
  targetForm().elements.target_miles.addEventListener('input', clearTargetErrors);
  $('#target-remove').addEventListener('click', removeTarget);

  $('#passcode-form').addEventListener('submit', (event) => {
    event.preventDefault();
    passcode.set($('#passcode-input').value);
    $('#passcode-dialog').close();
    $('#passcode-input').value = '';
    loadRuns();
  });
}

// Lists each secret the Worker needs and whether it can see it.
function showSetup(missing) {
  for (const item of $$('#setup [data-secret]')) {
    const isMissing = missing.includes(item.dataset.secret);
    item.classList.toggle('is-missing', isMissing);
    $('.secret-status', item).textContent = isMissing ? 'Missing' : 'Found';
  }
  $('#loading').hidden = true;
  $('#setup').hidden = false;
  document.body.classList.add('needs-setup');
}

async function init() {
  $('#brand').textContent = `${PLAN.shortName} · ${PLAN.raceDate.slice(0, 4)}`;
  buildRunForm();
  wireEvents();
  renderChatPrivacy();
  let config;
  try {
    config = await fetchConfig();
  } catch (err) {
    $('#loading').textContent = `Couldn’t reach the server: ${err.message}`;
    return;
  }
  if (!config.configured) {
    showSetup(config.missing ?? []);
    return;
  }
  showChatStatus(config);
  await loadRuns();
}

init();
