// Small dependency-free SVG charts: column, line and scatter, all
// single-series, responsive, with a hover / keyboard tooltip.
//
// Spec shape (all kinds):
//   points:      [{ label, value, tooltip: { value, title, detail? } }]
//                value may be null (a gap in a line)
//   yFormat:     value -> axis tick text
//   valueFormat: value -> direct label on the latest point (defaults to yFormat)
//   yZero:       start the y axis at 0 (default true)
//   yTime:       values are seconds; tick on clock-friendly steps (15s, 30s, 1m…)
//   yInvert:     smaller values at the top (e.g. faster paces)
//   ariaLabel
//
// Line charts on a time scale also take:
//   xDomain:     [min, max] in the same units as each point's `x` (e.g. ms)
//   xTicks:      [{ x, label }] axis labels; crowded ones are dropped
//   carryTo:     an x to extend the last value to with a dashed line
//
// Scatter charts take points with `x` (numeric), `value`, `size` (0–1, drawn
// as dot area) and optional `directLabel`, plus `xFormat` for x tick text and
// `xIntegers` to keep x ticks on whole numbers.

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 208;
const MARGIN = { top: 22, right: 14, bottom: 28 };
const BAR_MAX = 24;
const MIN_LABEL_GAP = 52;
const X_PAD = 10;
const DOT_MAX_R = 12;
const DOT_MIN_R = 4;

function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.appendChild(node);
  return node;
}

function svgText(parent, text, attrs) {
  const node = svgEl('text', attrs, parent);
  node.textContent = text;
  return node;
}

const TIME_STEPS = [15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export function niceTicks(min, max, count = 4, time = false, integer = false) {
  if (!(max > min)) max = min + 1;
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step = time
    ? (TIME_STEPS.find((s) => s >= rough) ?? TIME_STEPS.at(-1))
    : Math.max(integer ? 1 : 0, ((integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).find((s) => norm <= s) ?? 10) * magnitude);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

// Keeps x labels at least MIN_LABEL_GAP apart, always including the last.
function pickLabelIndexes(xs) {
  const keep = [];
  let lastX = Infinity;
  for (let i = xs.length - 1; i >= 0; i--) {
    if (lastX - xs[i] >= MIN_LABEL_GAP) {
      keep.push(i);
      lastX = xs[i];
    }
  }
  return new Set(keep);
}

function roundedTopBar(x, y, width, base) {
  const r = Math.min(4, width / 2, base - y);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${base}Z`;
}

function linePath(coords) {
  let d = '';
  let pen = false;
  for (const c of coords) {
    if (!c) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${c.x},${c.y}`;
    pen = true;
  }
  return d;
}

function showTooltip(host, tooltip, point, x, y) {
  tooltip.replaceChildren();
  const value = document.createElement('strong');
  value.textContent = point.tooltip?.value ?? String(point.value);
  const label = document.createElement('span');
  label.textContent = point.tooltip?.title ?? point.label;
  tooltip.append(value, label);
  if (point.tooltip?.detail) {
    const detail = document.createElement('span');
    detail.textContent = point.tooltip.detail;
    tooltip.append(detail);
  }
  tooltip.hidden = false;
  const width = tooltip.offsetWidth;
  const left = Math.min(Math.max(x - width / 2, 0), host.clientWidth - width);
  tooltip.style.transform = `translate(${left}px, ${Math.max(y - tooltip.offsetHeight - 12, 0)}px)`;
}

function edgeAnchor(x, left, right, room = 20) {
  return x - left < room ? 'start' : right - x < room ? 'end' : 'middle';
}

// Hover, tap and arrow-key focus over a set of point positions. `nearest`
// picks the point for a pointer position; `order` is the arrow-key order.
function wireFocus({ host, svg, tooltip, overlay, points, coords, nearest, order, onActivate, onDeactivate }) {
  svg.setAttribute('tabindex', 0);
  let active = -1;
  const activate = (i) => {
    if (i < 0) return;
    active = i;
    onActivate(i);
    showTooltip(host, tooltip, points[i], coords[i].x, coords[i].y);
  };
  const deactivate = () => {
    active = -1;
    onDeactivate();
    tooltip.hidden = true;
  };
  overlay.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const i = nearest(event.clientX - box.left, event.clientY - box.top);
    if (i >= 0 && i !== active) activate(i);
  });
  overlay.addEventListener('pointerleave', deactivate);
  svg.addEventListener('focus', () => activate(active >= 0 ? active : order.at(-1)));
  svg.addEventListener('blur', deactivate);
  svg.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const pos = Math.max(order.indexOf(active), 0);
    const next = event.key === 'ArrowLeft' ? Math.max(pos - 1, 0) : Math.min(pos + 1, order.length - 1);
    activate(order[next]);
  });
}

function draw(host) {
  const spec = host._chartSpec;
  const width = host.clientWidth;
  if (!spec || !width) return;
  host._chartWidth = width;

  const { points, yFormat = String, yZero = true } = spec;
  const values = points.map((p) => p.value).filter((v) => v != null && Number.isFinite(v));

  const svg = svgEl('svg', {
    width,
    height: HEIGHT,
    viewBox: `0 0 ${width} ${HEIGHT}`,
    role: 'img',
    'aria-label': spec.ariaLabel ?? '',
  });
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  host.replaceChildren(svg, tooltip);

  if (!values.length || (spec.kind === 'column' && values.every((v) => v === 0))) {
    svgText(svg, 'No runs yet', { x: width / 2, y: HEIGHT / 2, 'text-anchor': 'middle', class: 'chart-empty' });
    return;
  }

  const ticks = niceTicks(yZero ? 0 : Math.min(...values), Math.max(...values), 4, spec.yTime);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map(yFormat);
  const left = Math.max(...tickLabels.map((t) => t.length)) * 7 + 12;
  const right = width - MARGIN.right;
  const plotW = right - left;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const base = MARGIN.top + plotH;
  const share = (v) => (v - yMin) / (yMax - yMin);
  const yScale = spec.yInvert ? (v) => MARGIN.top + share(v) * plotH : (v) => base - share(v) * plotH;

  // Gridlines and y ticks.
  const grid = svgEl('g', { class: 'chart-grid' }, svg);
  ticks.forEach((tick, i) => {
    const y = Math.round(yScale(tick)) + 0.5;
    const isBase = Math.abs(y - base) < 1;
    svgEl('line', { x1: left, x2: right, y1: y, y2: y, class: isBase ? 'chart-baseline' : '' }, grid);
    svgText(grid, tickLabels[i], { x: left - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-tick' });
  });

  if (spec.kind === 'scatter') {
    drawScatter({ host, svg, tooltip, spec, left, right, base, yScale });
    return;
  }

  const n = points.length;
  const band = plotW / n;
  const timeScale = Array.isArray(spec.xDomain);
  const xOf = (x) => {
    const [a, b] = spec.xDomain;
    return left + X_PAD + ((x - a) / (b - a || 1)) * (plotW - X_PAD * 2);
  };
  const xs = timeScale ? points.map((p) => xOf(p.x)) : points.map((_, i) => left + band * (i + 0.5));

  // X labels: explicit ticks on a time scale, otherwise the points' labels.
  const xAxis = svgEl('g', { class: 'chart-grid' }, svg);
  const xLabels = timeScale && spec.xTicks ? spec.xTicks.map((t) => ({ x: xOf(t.x), label: t.label })) : points.map((p, i) => ({ x: xs[i], label: p.label }));
  const keep = pickLabelIndexes(xLabels.map((l) => l.x));
  xLabels.forEach((l, i) => {
    if (!keep.has(i)) return;
    svgText(xAxis, l.label, { x: l.x, y: HEIGHT - 8, 'text-anchor': edgeAnchor(l.x, left, right), class: 'chart-tick' });
  });

  const marks = svgEl('g', {}, svg);
  const lastIndex = points.findLastIndex((p) => p.value != null);

  if (spec.kind === 'column') {
    const barW = Math.max(2, Math.min(BAR_MAX, band - 2, band * 0.7));
    points.forEach((p, i) => {
      if (!p.value) return;
      const y = yScale(p.value);
      svgEl('path', { d: roundedTopBar(xs[i] - barW / 2, y, barW, base), class: 'chart-bar' }, marks);
    });
    // Direct label on the latest column only; the tooltip and table carry the rest.
    if (lastIndex >= 0 && points[lastIndex].value) {
      svgText(marks, spec.valueFormat?.(points[lastIndex].value) ?? yFormat(points[lastIndex].value), {
        x: xs[lastIndex],
        y: yScale(points[lastIndex].value) - 6,
        'text-anchor': xs[lastIndex] > right - 20 ? 'end' : 'middle',
        class: 'chart-value',
      });
    }
    // Hit targets: the whole band, so thin bars are easy to tap.
    points.forEach((p, i) => {
      const hit = svgEl(
        'rect',
        {
          x: xs[i] - band / 2,
          y: MARGIN.top,
          width: band,
          height: plotH,
          class: 'chart-hit',
          tabindex: 0,
          'aria-label': `${p.tooltip?.title ?? p.label}: ${p.tooltip?.value ?? p.value}`,
        },
        svg,
      );
      const show = () => {
        hit.classList.add('is-active');
        showTooltip(host, tooltip, p, xs[i], yScale(p.value || 0));
      };
      const hide = () => {
        hit.classList.remove('is-active');
        tooltip.hidden = true;
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
    });
    return;
  }

  // Line chart.
  const coords = points.map((p, i) => (p.value == null ? null : { x: xs[i], y: yScale(p.value) }));
  svgEl('path', { d: linePath(coords), class: 'chart-line' }, marks);
  if (timeScale && spec.carryTo != null && lastIndex >= 0) {
    const c = coords[lastIndex];
    const x2 = xOf(spec.carryTo);
    if (x2 > c.x + 2) svgEl('line', { x1: c.x, y1: c.y, x2, y2: c.y, class: 'chart-line chart-line-carry' }, marks);
  }
  const showAllDots = plotW / n >= 10;
  coords.forEach((c, i) => {
    if (c && (showAllDots || i === lastIndex)) svgEl('circle', { cx: c.x, cy: c.y, r: 4, class: 'chart-dot' }, marks);
  });
  if (lastIndex >= 0) {
    const c = coords[lastIndex];
    svgText(marks, spec.valueFormat?.(points[lastIndex].value) ?? yFormat(points[lastIndex].value), {
      x: c.x,
      y: c.y - 10,
      'text-anchor': c.x > right - 30 ? 'end' : 'middle',
      class: 'chart-value',
    });
  }

  // Crosshair: snaps to the nearest point with a value.
  const crosshair = svgEl('line', { y1: MARGIN.top, y2: base, class: 'chart-crosshair', visibility: 'hidden' }, svg);
  const focusDot = svgEl('circle', { r: 5, class: 'chart-dot chart-dot-focus', visibility: 'hidden' }, svg);
  const overlay = svgEl('rect', { x: left, y: 0, width: plotW, height: base, class: 'chart-hit' }, svg);
  const withValues = coords.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  wireFocus({
    host,
    svg,
    tooltip,
    overlay,
    points,
    coords,
    order: withValues,
    nearest: (px) => withValues.reduce((best, i) => (best < 0 || Math.abs(coords[i].x - px) < Math.abs(coords[best].x - px) ? i : best), -1),
    onActivate: (i) => {
      const c = coords[i];
      crosshair.setAttribute('x1', c.x);
      crosshair.setAttribute('x2', c.x);
      crosshair.setAttribute('visibility', 'visible');
      focusDot.setAttribute('cx', c.x);
      focusDot.setAttribute('cy', c.y);
      focusDot.setAttribute('visibility', 'visible');
    },
    onDeactivate: () => {
      crosshair.setAttribute('visibility', 'hidden');
      focusDot.setAttribute('visibility', 'hidden');
    },
  });
}

// Scatter: one dot per point, area showing `size`.
function drawScatter({ host, svg, tooltip, spec, left, right, base, yScale }) {
  const points = spec.points.filter((p) => p.value != null && Number.isFinite(p.x));
  const xTicks = niceTicks(Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)), 4, false, spec.xIntegers);
  const [x0, x1] = [xTicks[0], xTicks.at(-1)];
  const xOf = (x) => left + DOT_MAX_R + ((x - x0) / (x1 - x0)) * (right - left - DOT_MAX_R * 2);

  const xAxis = svgEl('g', { class: 'chart-grid' }, svg);
  const tickXs = xTicks.map(xOf);
  const keep = pickLabelIndexes(tickXs);
  xTicks.forEach((t, i) => {
    if (keep.has(i)) svgText(xAxis, (spec.xFormat ?? String)(t), { x: tickXs[i], y: HEIGHT - 8, 'text-anchor': edgeAnchor(tickXs[i], left, right), class: 'chart-tick' });
  });

  const coords = points.map((p) => ({
    x: xOf(p.x),
    y: yScale(p.value),
    r: Math.max(DOT_MIN_R, DOT_MAX_R * Math.sqrt(Math.max(p.size ?? 0, 0))),
  }));

  // Biggest dots first so small ones stay visible on top.
  const marks = svgEl('g', {}, svg);
  const bySize = coords.map((_, i) => i).sort((a, b) => coords[b].r - coords[a].r);
  for (const i of bySize) svgEl('circle', { cx: coords[i].x, cy: coords[i].y, r: coords[i].r, class: 'chart-dot-solid' }, marks);
  // Labels sit above their dot (dots in similar weather cluster side by
  // side) with a dark outline so they stay readable over neighbours.
  points.forEach((p, i) => {
    if (!p.directLabel) return;
    const c = coords[i];
    const above = c.y - c.r - 6 > MARGIN.top - 8;
    svgText(marks, p.directLabel, {
      x: c.x,
      y: above ? c.y - c.r - 6 : c.y + c.r + 14,
      'text-anchor': edgeAnchor(c.x, left, right, 30),
      class: 'chart-value chart-value-halo',
    });
  });

  const ring = svgEl('circle', { class: 'chart-dot-ring', visibility: 'hidden' }, svg);
  const overlay = svgEl('rect', { x: left, y: 0, width: right - left, height: base, class: 'chart-hit' }, svg);
  const order = coords.map((_, i) => i).sort((a, b) => coords[a].x - coords[b].x);
  wireFocus({
    host,
    svg,
    tooltip,
    overlay,
    points,
    coords,
    order,
    // The closest dot wins, so you never have to land exactly on one.
    nearest: (px, py) =>
      coords.reduce((best, c, i) => {
        const d = (c.x - px) ** 2 + (c.y - py) ** 2;
        return best.i < 0 || d < best.d ? { i, d } : best;
      }, { i: -1, d: Infinity }).i,
    onActivate: (i) => {
      ring.setAttribute('cx', coords[i].x);
      ring.setAttribute('cy', coords[i].y);
      ring.setAttribute('r', coords[i].r + 3);
      ring.setAttribute('visibility', 'visible');
    },
    onDeactivate: () => ring.setAttribute('visibility', 'hidden'),
  });
}

export function renderChart(host, spec) {
  host._chartSpec = spec;
  if (!host._chartObserver) {
    host._chartObserver = new ResizeObserver(() => {
      if (host.clientWidth !== host._chartWidth) draw(host);
    });
    host._chartObserver.observe(host);
  }
  draw(host);
}
