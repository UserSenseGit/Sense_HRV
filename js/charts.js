// Grafiekhulpjes (Chart.js) in stijl B3.

const C = {
  muted: '#a8a29e', line: '#2a2e38', text: '#e7e5e4', accent: '#fdba74', band: '#3f6f8f', ok: '#9cc33a', olive: '#759e0e', alert: '#f87171',
  bandFill: 'rgba(63, 111, 143, 0.22)',
};
export { C as CHART_COLORS };

const short = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Heatmap-rijen onder de x-as, uitgelijnd op de staafjes.
const heatPlugin = {
  id: 'heatRows',
  afterDraw(chart, _args, opts) {
    const rows = opts?.rows;
    if (!rows?.length) return;
    const { ctx, scales: { x }, chartArea } = chart;
    const n = chart.data.labels.length;
    const cell = (chartArea.right - chartArea.left) / n;
    const top = chart.height - rows.length * (opts.rowH + opts.gap) - 2;
    ctx.save();
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    rows.forEach((row, ri) => {
      const y = top + ri * (opts.rowH + opts.gap);
      ctx.fillStyle = C.muted;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, 0, y + opts.rowH / 2);
      row.cells.forEach((col, j) => {
        if (!col) return;
        const cx = x.getPixelForValue(j);
        ctx.fillStyle = col;
        const w = Math.max(1, cell - (cell > 4 ? 1.5 : 0.5));
        ctx.fillRect(cx - w / 2, y, w, opts.rowH);
      });
    });
    ctx.restore();
  },
};

function baseOptions({ heatRows, yLabelWidth = 34, onPick, suggestedMin, suggestedMax }) {
  const pad = heatRows?.length ? heatRows.length * 15 + 6 : 0;
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    layout: { padding: { bottom: pad, right: 4 } },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid: { display: false }, ticks: { color: C.muted, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
      y: {
        grid: { color: C.line }, ticks: { color: C.muted, font: { size: 10 }, maxTicksLimit: 5 },
        suggestedMin, suggestedMax,
        afterFit: (s) => { s.width = Math.max(s.width, heatRows?.length ? 58 : yLabelWidth); },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
      heatRows: { rows: heatRows || [], rowH: 11, gap: 4 },
    },
    onClick: (e, els, chart) => {
      if (!onPick) return;
      const pts = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, true);
      if (pts.length) onPick(pts[0].index);
    },
  };
}

const registry = new Map();
function mount(canvas, config) {
  registry.get(canvas)?.destroy();
  const ch = new Chart(canvas.getContext('2d'), config);
  registry.set(canvas, ch);
  return ch;
}
export { mount as mountChart };
export function destroyAll() { for (const ch of registry.values()) ch.destroy(); registry.clear(); }

/**
 * Staafjes per dag + baseline-lijn + normale band.
 * series: [{ date, value, baseline, lo, hi, color }]
 */
export function bandBarChart(canvas, series, { heatRows, onPick, decimals = 0, barOnly = false } = {}) {
  const labels = series.map((s) => short(s.date));
  return mount(canvas, {
    type: 'bar',
    plugins: [heatPlugin],
    data: {
      labels,
      datasets: [
        { type: 'line', data: series.map((s) => s.lo), borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true, order: 3 },
        { type: 'line', data: series.map((s) => s.hi), borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: C.bandFill, spanGaps: true, order: 3 },
        ...(barOnly ? [] : [{ type: 'line', data: series.map((s) => s.baseline), borderColor: C.text, borderWidth: 2, pointRadius: series.length > 45 ? 0 : 2, pointBackgroundColor: C.text, tension: 0.25, spanGaps: true, order: 1 }]),
        { type: 'bar', data: series.map((s) => (s.value == null ? null : Number(s.value.toFixed(decimals + 1)))), backgroundColor: series.map((s) => s.color), borderRadius: { topLeft: 2, topRight: 2 }, borderSkipped: 'bottom', barPercentage: 0.8, categoryPercentage: 0.9, order: 2 },
      ],
    },
    options: (() => {
      // y-as dicht bij de waarden laten beginnen (staafjes vanaf de onderrand), zodat de band leesbaar blijft
      const all = series.flatMap((s) => [s.value, s.lo, s.hi, s.baseline]).filter((v) => v != null);
      const o = baseOptions({ heatRows, onPick });
      if (all.length) {
        const lo = Math.min(...all), hi = Math.max(...all);
        o.scales.y.min = Math.max(0, Math.floor(lo - (hi - lo) * 0.15));
        o.scales.y.suggestedMax = hi;
      }
      return o;
    })(),
  });
}

/** Lijn met optionele band. series: [{ date, value, lo, hi }] */
export function bandLineChart(canvas, series, { color = C.text, onPick, highlightLast = true, decimals = 1 } = {}) {
  const labels = series.map((s) => short(s.date));
  const hasBand = series.some((s) => s.lo != null);
  return mount(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        ...(hasBand ? [
          { data: series.map((s) => s.lo), borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true },
          { data: series.map((s) => s.hi), borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: C.bandFill, spanGaps: true },
        ] : []),
        {
          data: series.map((s) => (s.value == null ? null : Number(s.value.toFixed(decimals)))), borderColor: color, borderWidth: 2, tension: 0.25, spanGaps: true,
          pointRadius: series.map((_, i) => (highlightLast && i === series.length - 1 ? 4 : series.length > 45 ? 0 : 2)),
          pointBackgroundColor: series.map((_, i) => (highlightLast && i === series.length - 1 ? C.accent : color)),
        },
      ],
    },
    options: baseOptions({ onPick }),
  });
}

/** Radar: huidige week t.o.v. vorige maand. axes: [{ label, cur, prev }] */
export function radarChart(canvas, axes) {
  return mount(canvas, {
    type: 'radar',
    data: {
      labels: axes.map((a) => a.label),
      datasets: [
        { data: axes.map((a) => a.prev), borderColor: C.muted, borderDash: [4, 4], borderWidth: 1.5, backgroundColor: 'rgba(168, 162, 158, 0.06)', pointRadius: 0 },
        { data: axes.map((a) => a.cur), borderColor: C.accent, borderWidth: 2, backgroundColor: 'rgba(253, 186, 116, 0.15)', pointRadius: 3, pointBackgroundColor: C.accent },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        r: {
          min: 0, max: 100, angleLines: { color: C.line }, grid: { color: C.line },
          ticks: { display: false }, pointLabels: { color: C.text, font: { size: 11 } },
        },
      },
    },
  });
}

/** Kleine sparkline als inline SVG (geen Chart.js nodig). */
export function sparkline(values, { w = 96, h = 28, color = '#7aa7c7' } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v);
  const pts = values.map((x, i) => (x == null ? null : [(i / (values.length - 1)) * w, h - 3 - ((x - lo) / (hi - lo || 1)) * (h - 6)])).filter(Boolean);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}"/></svg>`;
}
