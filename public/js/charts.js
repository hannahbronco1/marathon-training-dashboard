// Small dependency-free SVG charts: a column chart and a line chart, both
// single-series, responsive, with a hover / keyboard tooltip.
//
// Spec shape (both kinds):
//   points:      [{ label, value, tooltip: { value, title, detail? } }]
//                value may be null (a gap in a line)
//   yFormat:     value -> axis tick text
//   valueFormat: value -> direct label on the latest point (defaults to yFormat)
//   yZero:       start the y axis at 0 (default true)
//   ariaLabel

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 208;
const MARGIN = { top: 22, right: 14, bottom: 28 };
const BAR_MAX = 24;
const MIN_LABEL_GAP = 52;

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

export function niceTicks(min, max, count = 4) {
  if (!(max > min)) max = min + 1;
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
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
    svgText(svg, 'No runs in this range', {
      x: width / 2,
      y: HEIGHT / 2,
      'text-anchor': 'middle',
      class: 'chart-empty',
    });
    return;
  }

  const ticks = niceTicks(yZero ? 0 : Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map(yFormat);
  const left = Math.max(...tickLabels.map((t) => t.length)) * 7 + 12;
  const plotW = width - left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const base = MARGIN.top + plotH;
  const yScale = (v) => base - ((v - yMin) / (yMax - yMin)) * plotH;

  // Gridlines and y ticks.
  const grid = svgEl('g', { class: 'chart-grid' }, svg);
  ticks.forEach((tick, i) => {
    const y = Math.round(yScale(tick)) + 0.5;
    svgEl('line', { x1: left, x2: width - MARGIN.right, y1: y, y2: y, class: i === 0 ? 'chart-baseline' : '' }, grid);
    svgText(grid, tickLabels[i], { x: left - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-tick' });
  });

  const n = points.length;
  const band = plotW / n;
  const xs = points.map((_, i) => left + band * (i + 0.5));

  // X labels.
  const labelIndexes = pickLabelIndexes(xs);
  const xAxis = svgEl('g', { class: 'chart-grid' }, svg);
  points.forEach((p, i) => {
    if (!labelIndexes.has(i)) return;
    const anchor = xs[i] - left < 20 ? 'start' : width - MARGIN.right - xs[i] < 20 ? 'end' : 'middle';
    svgText(xAxis, p.label, { x: xs[i], y: HEIGHT - 8, 'text-anchor': anchor, class: 'chart-tick' });
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
        'text-anchor': xs[lastIndex] > width - MARGIN.right - 20 ? 'end' : 'middle',
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
  const showAllDots = band >= 10;
  coords.forEach((c, i) => {
    if (c && (showAllDots || i === lastIndex)) svgEl('circle', { cx: c.x, cy: c.y, r: 4, class: 'chart-dot' }, marks);
  });
  if (lastIndex >= 0) {
    const c = coords[lastIndex];
    svgText(marks, spec.valueFormat?.(points[lastIndex].value) ?? yFormat(points[lastIndex].value), {
      x: c.x,
      y: c.y - 10,
      'text-anchor': c.x > width - MARGIN.right - 30 ? 'end' : 'middle',
      class: 'chart-value',
    });
  }

  // Crosshair: snaps to the nearest point with a value.
  const crosshair = svgEl('line', { y1: MARGIN.top, y2: base, class: 'chart-crosshair', visibility: 'hidden' }, svg);
  const focusDot = svgEl('circle', { r: 5, class: 'chart-dot chart-dot-focus', visibility: 'hidden' }, svg);
  const overlay = svgEl('rect', { x: left, y: 0, width: plotW, height: base, class: 'chart-hit' }, svg);
  svg.setAttribute('tabindex', 0);
  let active = -1;

  const activate = (i) => {
    active = i;
    const c = coords[i];
    crosshair.setAttribute('x1', c.x);
    crosshair.setAttribute('x2', c.x);
    crosshair.setAttribute('visibility', 'visible');
    focusDot.setAttribute('cx', c.x);
    focusDot.setAttribute('cy', c.y);
    focusDot.setAttribute('visibility', 'visible');
    showTooltip(host, tooltip, points[i], c.x, c.y);
  };
  const deactivate = () => {
    active = -1;
    crosshair.setAttribute('visibility', 'hidden');
    focusDot.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };
  const nearest = (px) => {
    let best = -1;
    let bestDist = Infinity;
    coords.forEach((c, i) => {
      if (c && Math.abs(c.x - px) < bestDist) {
        best = i;
        bestDist = Math.abs(c.x - px);
      }
    });
    return best;
  };
  const step = (from, dir) => {
    for (let i = from + dir; i >= 0 && i < n; i += dir) if (coords[i]) return i;
    return from;
  };

  overlay.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const i = nearest(event.clientX - box.left);
    if (i >= 0 && i !== active) activate(i);
  });
  overlay.addEventListener('pointerleave', deactivate);
  svg.addEventListener('focus', () => activate(active >= 0 ? active : lastIndex));
  svg.addEventListener('blur', deactivate);
  svg.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    activate(step(active >= 0 ? active : lastIndex, event.key === 'ArrowLeft' ? -1 : 1));
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
