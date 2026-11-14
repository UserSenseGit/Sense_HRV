// Trends (fase 2): HRV-trends, baselinegrafiek, HR, CV, genormaliseerde HRV en readiness-score.

import { $, esc, notify, niceDate, longDate, addDays, isoDate } from './util.js';
import { getAll } from './db.js';
import { renderTraining } from './trainingview.js';
import {
  buildSeries, trendAt, TREND_INFO, DIR_LABEL, DIR_ARROW, heatClass, HEAT_COLORS, PARAMS, DEFAULT_READINESS,
  readinessSeries, readinessAdvice, weekVsMonth, radarPoint, CATEGORY_LABEL,
} from './analytics.js';
import { bandBarChart, bandLineChart, radarChart, sparkline, destroyAll, CHART_COLORS as C } from './charts.js';

const PERIODS = [[30, '30 d'], [60, '60 d'], [90, '90 d'], [365, '1 jaar']];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};
export const readinessParams = () => {
  const p = store.get('sense.readiness', DEFAULT_READINESS).filter((k) => PARAMS[k]);
  return p.length >= 3 ? p : DEFAULT_READINESS;
};

export function valueColor(d, isLast) {
  if (isLast) return C.accent;
  if (d.category === 'below') return C.alert;
  if (d.category && d.category !== 'within') return C.olive;
  return C.band;
}
const fmt = (v, dec = 0) => (v == null ? '–' : Number(v).toFixed(dec).replace('.', ','));
const pct = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`);

/** Laadt alle data en berekent de reeks (één keer per render). */
export async function loadSeries() {
  const records = await getAll();
  const s = buildSeries(records);
  readinessSeries(s.days, readinessParams());
  return s;
}

/** Index van de laatste dag met een rMSSD-meting. */
export function lastMeasuredIndex(days) {
  for (let i = days.length - 1; i >= 0; i--) if (days[i].rmssd != null) return i;
  return -1;
}

function heatRow(label, slice, key) {
  return { label, cells: slice.map((d) => HEAT_COLORS[heatClass(d.pz?.[key])] || null) };
}
function markerRow(label, slice, test, color) {
  return { label, cells: slice.map((d) => (d.rec && test(d.rec.tags || {}) ? color : null)) };
}

function adviceCard(a, title) {
  if (!a) return '';
  const tone = { ok: 'var(--ok)', warn: 'var(--accent)', alert: 'var(--alert)', muted: 'var(--muted)' }[a.level];
  return `<div class="notice" style="${a.level === 'ok' ? 'background: var(--card);' : a.level === 'alert' ? 'background: #2a1618;' : ''}">
    <div><span class="small muted">${esc(title || 'Advies')}</span><br><b style="color: ${tone};">${esc(a.title)}</b><p>${esc(a.text)}</p></div></div>`;
}
export { adviceCard };

const legend = (items) => `<div class="legend">${items.map(([c, l]) => `<span><i style="background: ${c}"></i>${esc(l)}</span>`).join('')}</div>`;

export async function renderTrends() {
  const el = $('view-trends');
  destroyAll();
  const mode = store.get('sense.trendsMode', 'hrv');
  const toggle = `<div class="seg-ctl view-toggle" role="group" aria-label="Onderdeel">
    <button type="button" data-tmode="hrv" aria-pressed="${mode === 'hrv'}">HRV</button>
    <button type="button" data-tmode="training" aria-pressed="${mode === 'training'}">Training</button></div>`;
  const bindToggle = () => el.querySelectorAll('button[data-tmode]').forEach((b) => { b.onclick = () => { store.set('sense.trendsMode', b.dataset.tmode); renderTrends(); }; });
  if (mode === 'training') {
    await renderTraining(el, toggle);
    bindToggle();
    return;
  }
  const { days } = await loadSeries();
  const li = lastMeasuredIndex(days);
  if (li < 0) {
    el.innerHTML = '<h2 class="view-title">Trends</h2><div class="card empty">Nog geen metingen. Importeer je HRV4Training-geschiedenis via Meer.</div>';
    return;
  }
  const period = store.get('sense.period', 60);
  const end = days.length - 1;
  const slice = days.slice(Math.max(0, end - period + 1), end + 1);
  const last = days[li];
  const tr = trendAt(days, li);
  const info = tr ? TREND_INFO[tr.key] : null;
  const toneColor = { ok: 'var(--ok)', muted: 'var(--muted)', warn: 'var(--accent)', alert: 'var(--alert)' };
  const spark14 = (key) => sparkline(days.slice(Math.max(0, li - 13), li + 1).map((d) => d[key]));
  const heatOk = period <= 90;

  el.innerHTML = `
    <h2 class="view-title">Trends</h2>
    ${toggle}
    <div class="seg-ctl" role="group" aria-label="Periode">
      ${PERIODS.map(([v, l]) => `<button type="button" data-period="${v}" aria-pressed="${v === period}">${l}</button>`).join('')}
    </div>

    <div class="card">
      <div class="small" style="color: ${info ? toneColor[info.tone] : 'var(--muted)'}; letter-spacing: .1em; text-transform: uppercase; font-weight: 600;">14-dagentrend</div>
      <div class="num" style="font-size: 22px; margin: 4px 0 6px;">${info ? esc(info.label) : 'Nog te weinig data'}</div>
      <p class="small muted" style="margin: 0 0 12px;">${info ? esc(info.text) : 'Minstens 30 metingen in de laatste 60 dagen nodig.'}</p>
      <div class="trend-rows">
        ${[['rMSSD-baseline', last.baseline, 'ms', 'baseline', tr?.hrv, 0], ['HR-baseline', last.hrBaseline, 'bpm', 'hrBaseline', tr?.hr, 0], ['HRV-variatie (CV)', last.cv, '%', 'cv', tr?.cv, 1]]
          .map(([l, v, u, k, dir, dec]) => `<div class="trend-row"><div><div>${l}</div><div class="small muted">${fmt(v, dec)} ${u}</div></div>${spark14(k)}<div class="small" style="text-align: right; min-width: 72px;">${dir ? `${DIR_ARROW[dir]} ${DIR_LABEL[dir]}` : '–'}</div></div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="between"><h3 class="card-title" style="margin: 0;">rMSSD, baseline en normale band</h3></div>
      <div class="small muted" style="margin: 4px 0 8px;">Vandaag ${fmt(last.rmssd)} ms · baseline ${fmt(last.baseline)} · band ${fmt(last.bandLo)}–${fmt(last.bandHi)}</div>
      <div class="chart-wrap" style="height: ${heatOk ? 300 : 240}px;"><canvas id="chBase" role="img" aria-label="rMSSD per dag met baseline en normale band"></canvas></div>
      ${legend([[C.band, 'binnen band'], [C.alert, 'onder band'], [C.olive, 'boven band'], [C.accent, 'laatste'], ['#e7e5e4', 'baseline (7 d)']])}
      ${heatOk ? legend([[HEAT_COLORS.worse, 'slechter dan gewoonlijk'], [HEAT_COLORS.normal, 'normaal'], [HEAT_COLORS.better, 'beter dan gewoonlijk'], ['#b49be6', 'alcohol'], ['#f87171', 'ziek']]) : '<p class="small muted" style="margin: 8px 0 0;">Tag-rijen worden getoond bij 90 dagen of minder.</p>'}
      <div id="pickInfo" class="pick-info"></div>
    </div>

    <div class="card">
      <h3 class="card-title">HR-baseline</h3>
      <div class="small muted" style="margin: -4px 0 8px;">Baseline ${fmt(last.hrBaseline)} bpm · band ${fmt(last.hrLo)}–${fmt(last.hrHi)}</div>
      <div class="chart-wrap" style="height: 180px;"><canvas id="chHr" role="img" aria-label="Hartslag-baseline"></canvas></div>
    </div>

    <div class="card">
      <h3 class="card-title">HRV-variatiecoëfficiënt (CV)</h3>
      <div class="small muted" style="margin: -4px 0 8px;">Hoe sterk je dagwaarden schommelen (7 dagen, op ln rMSSD). Nu ${fmt(last.cv, 1)} %.</div>
      <div class="chart-wrap" style="height: 160px;"><canvas id="chCv" role="img" aria-label="Variatiecoëfficiënt"></canvas></div>
    </div>

    <div class="card">
      <h3 class="card-title">Genormaliseerde HRV</h3>
      <div class="row" style="align-items: baseline; gap: 8px;"><span class="num" style="font-size: 34px;">${fmt(last.nhrv, 1)}</span><span class="unit">ms</span>
        <span class="small muted">normaal ${fmt(last.nhrvLo, 1)}–${fmt(last.nhrvHi, 1)}</span></div>
      <p class="small muted" style="margin: 6px 0 10px;">rMSSD ${fmt(last.rmssd)} ÷ gem. RR ${fmt(last.rec?.avnn ?? (last.hr ? 60000 / last.hr : null))} ms × 100. Toont veranderingen in HRV die niet gewoon door een hogere of lagere hartslag komen.</p>
      <div class="chart-wrap" style="height: 160px;"><canvas id="chNhrv" role="img" aria-label="Genormaliseerde HRV"></canvas></div>
    </div>

    <h2 class="view-title" style="margin-top: 10px;">Readiness-score</h2>
    <div id="readiness" class="stack"></div>
  `;

  bindToggle();
  el.querySelectorAll('button[data-period]').forEach((b) => { b.onclick = () => { store.set('sense.period', Number(b.dataset.period)); renderTrends(); }; });

  const lastIdx = slice.length - 1 - (end - li);
  const pick = (i) => {
    const d = slice[i];
    if (!d) return;
    const t = d.rec?.tags || {};
    $('pickInfo').innerHTML = `<b>${esc(longDate(d.date))}</b><br>
      rMSSD ${fmt(d.rmssd)} · baseline ${fmt(d.baseline)} · band ${fmt(d.bandLo)}–${fmt(d.bandHi)}${d.category ? ` · ${CATEGORY_LABEL[d.category]}` : ''}<br>
      HR ${fmt(d.hr)} · slaap ${fmt(t.sleepQuality)} · motivatie ${fmt(t.motivation)} · spierpijn ${fmt(t.soreness)}${d.rec?.extrasystolen != null ? ` · ES ${d.rec.extrasystolen}` : ''}`;
  };
  bandBarChart($('chBase'), slice.map((d, i) => ({ date: d.date, value: d.rmssd, baseline: d.baseline, lo: d.bandLo, hi: d.bandHi, color: valueColor(d, i === lastIdx) })), {
    onPick: pick,
    heatRows: heatOk ? [heatRow('Slaap', slice, 'sleepQuality'), heatRow('Motivatie', slice, 'motivation'), heatRow('Spierpijn', slice, 'soreness'),
      markerRow('Alcohol', slice, (t) => t.alcohol && t.alcohol !== 'nothing', '#b49be6'), markerRow('Ziek', slice, (t) => t.sick, '#f87171')] : null,
  });
  pick(lastIdx);
  bandLineChart($('chHr'), slice.map((d) => ({ date: d.date, value: d.hrBaseline, lo: d.hrLo, hi: d.hrHi })), { decimals: 1 });
  bandLineChart($('chCv'), slice.map((d) => ({ date: d.date, value: d.cv })), { color: '#7aa7c7', decimals: 2 });
  bandLineChart($('chNhrv'), slice.map((d) => ({ date: d.date, value: d.nhrv, lo: d.nhrvLo, hi: d.nhrvHi })), { color: '#7aa7c7', decimals: 2 });

  renderReadiness(days, li, period);
}

function renderReadiness(days, li, period) {
  const box = $('readiness');
  const params = readinessParams();
  const d = days[li];
  const a = readinessAdvice(d);
  const axes = params.map((k) => {
    const ch = weekVsMonth(days, li, k);
    const pt = radarPoint(days, li, k);
    return { key: k, label: PARAMS[k].short || PARAMS[k].label, change: ch, cur: pt?.cur ?? 50, prev: pt?.prev ?? 50 };
  });
  const span = Math.min(period, 90);
  const end = days.length - 1;
  const slice = days.slice(Math.max(0, end - span + 1), end + 1);
  const lastIdx = slice.length - 1 - (end - li);
  const subj = params.filter((k) => !['hrv', 'hr'].includes(k));

  box.innerHTML = `
    <div class="grid-2">
      <div class="card"><div class="small muted">Score vandaag</div><div class="num accent-text" style="font-size: 34px;">${fmt(d.readiness)}</div>
        <div class="small muted">band ${fmt(d.rdLo)}–${fmt(d.rdHi)} · bl ${fmt(d.rdBaseline)}</div></div>
      <div class="card"><div class="small muted">HRV en HR</div><div class="num" style="font-size: 22px;">${fmt(d.rmssd)} <span class="unit">ms</span> · ${fmt(d.hr)} <span class="unit">bpm</span></div>
        <div class="small muted">${subj.length ? subj.map((k) => `${PARAMS[k].short || PARAMS[k].label} ${fmt(PARAMS[k].get(d.rec || {}), 1)}`).join(' · ') : '&nbsp;'}</div></div>
    </div>
    ${adviceCard(a, 'Advies op basis van je readiness-score')}

    <div class="card">
      <h3 class="card-title">Parameters (3 tot 8)</h3>
      <div class="chips">
        ${Object.entries(PARAMS).map(([k, p]) => `<button type="button" class="chip" data-param="${k}" aria-pressed="${params.includes(k)}">${esc(p.label)} <span class="small muted">${p.better > 0 ? '↑ beter' : '↑ slechter'}</span></button>`).join('')}
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Deze week t.o.v. vorige maand</h3>
      <div class="chart-wrap" style="height: 260px;"><canvas id="chRadar" role="img" aria-label="Radar: laatste 7 dagen tegenover de 30 dagen daarvoor"></canvas></div>
      ${legend([[C.accent, 'laatste 7 dagen'], [C.muted, 'vorige 30 dagen']])}
      <dl class="kv" style="margin: 10px 0 0;">${axes.map((x) => `<dt>${esc(PARAMS[x.key].label)}</dt><dd style="color: ${x.change == null ? 'inherit' : x.change * PARAMS[x.key].better >= 0 ? 'var(--ok)' : 'var(--alert)'}">${pct(x.change)}</dd>`).join('')}</dl>
      <p class="small muted" style="margin: 8px 0 0;">Elke as loopt van je slechtste (midden) tot je beste dagwaarde (buiten) van de laatste 90 dagen. Bij HR, spierpijn, vermoeidheid en extrasystolen is lager dus beter en ligt dat buiten.</p>
    </div>

    <div class="card">
      <h3 class="card-title">Cumulatieve score (${span} dagen)</h3>
      <div class="chart-wrap" style="height: ${120 + params.length * 15 + 160}px;"><canvas id="chReady" role="img" aria-label="Readiness-score per dag"></canvas></div>
      ${legend([[C.band, 'dagscore'], [C.alert, 'onder band'], [C.accent, 'laatste'], ['#e7e5e4', 'baseline (7 d)']])}
    </div>`;

  box.querySelectorAll('button[data-param]').forEach((b) => {
    b.onclick = () => {
      const cur = readinessParams();
      const k = b.dataset.param;
      let next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
      if (next.length < 3) { notify('Minimaal 3 parameters'); return; }
      if (next.length > 8) { notify('Maximaal 8 parameters'); return; }
      next = Object.keys(PARAMS).filter((x) => next.includes(x));
      store.set('sense.readiness', next);
      readinessSeries(days, next);
      renderReadiness(days, li, period);
    };
  });

  radarChart($('chRadar'), axes);
  bandBarChart($('chReady'), slice.map((x, i) => ({
    date: x.date, value: x.readiness, baseline: x.rdBaseline, lo: x.rdLo, hi: x.rdHi,
    color: i === lastIdx ? C.accent : x.readiness != null && x.rdLo != null && x.readiness < x.rdLo ? C.alert : C.band,
  })), { heatRows: params.map((k) => heatRow(PARAMS[k].short || PARAMS[k].label, slice, k)) });
}

// ---------------- Weekoverzicht (Historiek) ----------------
export async function renderWeek(container, offset, onPickDay = null) {
  const { days, byDate } = await loadSeries();
  const endDate = addDays(isoDate(), -7 * offset);
  const dates = [];
  for (let i = 6; i >= 0; i--) dates.push(addDays(endDate, -i));
  const w = dates.map((dt) => byDate.get(dt) || { date: dt, pz: {} });
  const vals = w.map((d) => d.rmssd).filter((v) => v != null);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const ref = [...w].reverse().find((d) => d.bandLo != null);
  const today = isoDate();
  const TR = { easy: 'licht', average: 'gem.', intense: 'zwaar' };
  const cell = (d, k) => `<span class="wk-cell" style="background: ${HEAT_COLORS[heatClass(d.pz?.[k])] || 'transparent'}"></span>`;

  container.innerHTML = `
    <div class="between" style="margin-bottom: 8px;">
      <button class="btn btn-sm" id="wkPrev" aria-label="Vorige week">‹</button>
      <div style="text-align: center;"><div class="small muted">${esc(niceDate(dates[0]))} – ${esc(niceDate(dates[6]))}</div>
        <div><span class="num accent-text">${fmt(avg)}</span> <span class="small muted">week-gem. · band ${fmt(ref?.bandLo)}–${fmt(ref?.bandHi)}</span></div></div>
      <button class="btn btn-sm" id="wkNext" aria-label="Volgende week" ${offset === 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="chart-wrap" style="height: 170px;"><canvas id="chWeek" role="img" aria-label="rMSSD deze week"></canvas></div>
    <div class="wk-grid">
      <span></span>${dates.map((dt) => `<button type="button" class="wk-h wk-day" data-day="${dt}" aria-label="${esc(niceDate(dt))} openen">${dt === today ? 'vdg' : `${dt.slice(8, 10)}/${dt.slice(5, 7)}`}</button>`).join('')}
      <span class="small muted">Training</span>${w.map((d) => { const t = d.rec?.tags || {}; return `<span class="wk-t">${t.training && t.training !== 'rest' ? `${esc(TR[t.training] || '')}${t.durationMin ? `<br>${t.durationMin}′` : ''}` : t.training === 'rest' ? '<span class="muted">rust</span>' : ''}</span>`; }).join('')}
      <span class="small muted">Slaap</span>${w.map((d) => cell(d, 'sleepQuality')).join('')}
      <span class="small muted">Spierpijn</span>${w.map((d) => cell(d, 'soreness')).join('')}
      <span class="small muted">Motivatie</span>${w.map((d) => cell(d, 'motivation')).join('')}
      <span class="small muted">ES</span>${w.map((d) => `<span class="wk-t">${d.rec?.extrasystolen ?? ''}</span>`).join('')}
    </div>
    ${legend([[HEAT_COLORS.worse, 'slechter'], [HEAT_COLORS.normal, 'normaal'], [HEAT_COLORS.better, 'beter dan gewoonlijk']])}`;

  const lastIdx = w.map((d) => d.rmssd != null).lastIndexOf(true);
  const ch = new Chart($('chWeek').getContext('2d'), {
    type: 'line',
    data: {
      labels: dates.map((dt) => `${dt.slice(8, 10)}/${dt.slice(5, 7)}`),
      datasets: [
        { data: w.map(() => ref?.bandLo ?? null), borderWidth: 0, pointRadius: 0, fill: false },
        { data: w.map(() => ref?.bandHi ?? null), borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: C.bandFill },
        { data: w.map((d) => d.rmssd ?? null), borderColor: '#5b616e', borderDash: [3, 4], borderWidth: 1.5, spanGaps: true,
          pointRadius: 6, pointBackgroundColor: w.map((d, i) => valueColor(d, i === lastIdx)), pointBorderWidth: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 16 } },
      scales: { x: { display: false }, y: { grid: { color: C.line }, ticks: { color: C.muted, font: { size: 10 }, maxTicksLimit: 4 }, suggestedMin: (ref?.bandLo ?? 40) - 10, suggestedMax: (ref?.bandHi ?? 60) + 5 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
    plugins: [{
      id: 'vals',
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(2);
        const { ctx } = chart;
        ctx.save(); ctx.fillStyle = '#e7e5e4'; ctx.font = '11px Inter, system-ui'; ctx.textAlign = 'center';
        meta.data.forEach((pt, i) => { const v = w[i].rmssd; if (v != null) ctx.fillText(Math.round(v), pt.x, pt.y - 10); });
        ctx.restore();
      },
    }],
  });
  container._chart?.destroy();
  container._chart = ch;
  $('wkPrev').onclick = () => renderWeek(container, offset + 1, onPickDay);
  $('wkNext').onclick = () => { if (offset > 0) renderWeek(container, offset - 1, onPickDay); };
  // Op een dag tikken (datum of punt in de grafiek) opent die dag
  const pickDay = (dt) => { if (onPickDay && byDate.get(dt)?.rec) onPickDay(dt); else if (onPickDay) notify('Geen gegevens', niceDate(dt)); };
  container.querySelectorAll('button[data-day]').forEach((b) => { b.onclick = () => pickDay(b.dataset.day); });
  ch.options.onClick = (e) => {
    const pts = ch.getElementsAtEventForMode(e, 'index', { intersect: false }, true);
    if (pts.length) pickDay(dates[pts[0].index]);
  };
}
