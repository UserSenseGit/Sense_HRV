// Trends → Training: trainingsbelasting, overzichten en intensiteitsverdeling.

import { esc, isoDate, addDays } from './util.js';
import { getAll } from './db.js';
import {
  trainingSettings, setTrainingSetting, sessionsFrom, loadSeries, riskZone, RISK_INFO, summaries, intensity,
  sportsOf, LOAD_METRICS, restingHr,
} from './training.js';
import { mountChart, CHART_COLORS as C } from './charts.js';

const ss = {
  get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};
const fmt = (v, dec = 0) => (v == null || Number.isNaN(v) ? '–' : Number(v).toFixed(dec).replace('.', ','));
const short = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const RANGES = [[90, '3 mnd'], [182, '6 mnd'], [365, '1 jaar'], [730, '2 jaar']];
const arrow = (now, before) => (before == null ? '' : Math.abs(now - before) < Math.max(0.5, Math.abs(before) * 0.05) ? '→' : now > before ? '↗' : '↘');
const legend = (items) => `<div class="legend">${items.map(([c, l]) => `<span><i style="background: ${c}"></i>${esc(l)}</span>`).join('')}</div>`;

function axisOpts(extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: C.muted, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
      y: { grid: { color: C.line }, ticks: { color: C.muted, font: { size: 10 }, maxTicksLimit: 5 }, ...extra },
    },
  };
}

export async function renderTraining(el, toggle) {
  const settings = trainingSettings();
  const records = await getAll();
  const sessions = sessionsFrom(records, settings);
  if (!sessions.length) {
    el.innerHTML = `<h2 class="view-title">Trends</h2>${toggle}<div class="card empty">Nog geen trainingen. Vul ze in bij de tags, of importeer je HRV4Training-geschiedenis via Meer.</div>`;
    return;
  }
  const metric = ss.get('sense.trMetric', settings.metric);
  const range = ss.get('sense.trRange', 182);
  const sumMode = ss.get('sense.trSumMode', 'week');
  const sport = ss.get('sense.trSport', 'all');
  const today = isoDate();
  const series = loadSeries(sessions, metric, today);
  const last = series[series.length - 1];
  const wk = series[series.length - 8];
  const slice = series.slice(-range);
  const zone = riskZone(last.ratio);
  const hrRest = restingHr(records, settings);
  const threshold = Math.round((settings.hrMax * settings.thresholdPct) / 100);
  const recent = sessions.filter((s) => s.date >= addDays(today, -89));
  const estimated = recent.filter((s) => s.trimpEstimated).length;
  const sports = sportsOf(sessions);
  const sums = summaries(sessions, metric, { mode: sumMode, sport, count: sumMode === 'week' ? 8 : 6, until: today });
  const cur = sums[sums.length - 1].total;
  const prev4 = sums.slice(-4); // zoals HRV4Training: laatste 4 periodes, de huidige inbegrepen
  const avg4 = prev4.reduce((a, b) => a + b.total, 0) / (prev4.length || 1);
  const change = avg4 ? ((cur - avg4) / avg4) * 100 : null;
  const dist = intensity(sessions, threshold, 28, today);
  const withHr = dist.low + dist.high;

  el.innerHTML = `
    <h2 class="view-title">Trends</h2>
    ${toggle}
    <div class="seg-ctl" role="group" aria-label="Maat voor belasting">
      ${Object.entries(LOAD_METRICS).map(([k, m]) => `<button type="button" data-metric="${k}" aria-pressed="${k === metric}">${k === 'trimp' ? 'TRIMP' : k === 'srpe' ? 'Duur×RPE' : m.label}</button>`).join('')}
    </div>

    <div class="grid-3">
      <div class="card"><div class="small muted">Fitheid (CTL)</div><div class="num accent-text" style="font-size: 24px;">${fmt(last.ctl, 1)} ${arrow(last.ctl, wk?.ctl)}</div></div>
      <div class="card"><div class="small muted">Vermoeidheid (ATL)</div><div class="num" style="font-size: 24px; color: #b49be6;">${fmt(last.atl, 1)} ${arrow(last.atl, wk?.atl)}</div></div>
      <div class="card"><div class="small muted">Vorm (CTL−ATL)</div><div class="num" style="font-size: 24px;">${fmt(last.form, 1)}</div></div>
    </div>

    <div class="card">
      <div class="between"><h3 class="card-title" style="margin: 0;">Fitheid en vermoeidheid</h3></div>
      <div class="seg-ctl" role="group" aria-label="Periode" style="margin: 10px 0;">
        ${RANGES.map(([v, l]) => `<button type="button" data-range="${v}" aria-pressed="${v === range}">${l}</button>`).join('')}
      </div>
      <div class="chart-wrap" style="height: 200px;"><canvas id="chLoad" role="img" aria-label="CTL en ATL"></canvas></div>
      ${legend([[C.accent, 'CTL (42 d)'], ['#b49be6', 'ATL (7 d)']])}
      <p class="small muted" style="margin: 8px 0 0;">CTL is wat je lichaam gewend is (fitheid), ATL wat je de laatste week deed (vermoeidheid).</p>
    </div>

    <div class="card">
      <h3 class="card-title">Vorm (readiness om te presteren)</h3>
      <div class="chart-wrap" style="height: 150px;"><canvas id="chForm" role="img" aria-label="Vorm, CTL min ATL"></canvas></div>
      <p class="small muted" style="margin: 8px 0 0;">Optimaal is meestal net boven nul: uitgerust, maar niet ontraind.</p>
    </div>

    <div class="card">
      <h3 class="card-title">Blessurerisico (ATL / CTL)</h3>
      <div class="row" style="gap: 12px; margin-bottom: 8px;">
        <span class="num" style="font-size: 28px; color: ${zone ? RISK_INFO[zone].color : 'inherit'};">${fmt(last.ratio, 2)}</span>
        <span>${zone ? esc(RISK_INFO[zone].label) : '–'}</span>
      </div>
      <div class="chart-wrap" style="height: 150px;"><canvas id="chRisk" role="img" aria-label="Verhouding acuut tot chronisch"></canvas></div>
      ${legend(Object.values(RISK_INFO).map((r) => [r.color, r.label]))}
      <p class="small muted" style="margin: 8px 0 0;">Onder 0,8 verlies je fitheid, 0,8–1,3 is optimaal, boven 1,3 stijgt het risico.</p>
    </div>

    <div class="card">
      <h3 class="card-title">${sumMode === 'week' ? 'Weekoverzicht' : 'Maandoverzicht'} · ${esc(LOAD_METRICS[metric].label)}</h3>
      <div class="grid-2" style="margin-bottom: 10px;">
        <select class="input" id="trSumMode" aria-label="Week of maand"><option value="week" ${sumMode === 'week' ? 'selected' : ''}>Per week</option><option value="month" ${sumMode === 'month' ? 'selected' : ''}>Per maand</option></select>
        <select class="input" id="trSport" aria-label="Sport"><option value="all">Alle sporten</option>${sports.map((s) => `<option ${s === sport ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      </div>
      <div class="chart-wrap" style="height: 180px;"><canvas id="chSum" role="img" aria-label="Totale belasting per periode"></canvas></div>
      <dl class="kv" style="margin: 10px 0 0;">
        <dt>${sumMode === 'week' ? 'Deze week (7 d)' : 'Deze maand'}</dt><dd>${fmt(cur)} ${LOAD_METRICS[metric].unit}</dd>
        <dt>Gemiddelde laatste 4</dt><dd>${fmt(avg4, 1)}</dd>
        <dt>Verandering</dt><dd style="color: ${change == null ? 'inherit' : change >= 0 ? 'var(--ok)' : 'var(--alert)'}">${change == null ? '–' : `${change > 0 ? '+' : ''}${fmt(change, 1)}%`}</dd>
      </dl>
    </div>

    <div class="card">
      <h3 class="card-title">Intensiteit · laatste 4 weken</h3>
      <div class="row" style="gap: 16px; align-items: center;">
        <div style="width: 130px; height: 130px; flex-shrink: 0;"><canvas id="chInt" role="img" aria-label="Verdeling licht en zwaar"></canvas></div>
        <dl class="kv" style="margin: 0; flex: 1;">
          <dt>Licht (&lt; ${threshold} bpm)</dt><dd style="color: var(--ok);">${withHr ? fmt((dist.low / withHr) * 100) : '–'}%</dd>
          <dt>Zwaar (≥ ${threshold} bpm)</dt><dd style="color: var(--accent);">${withHr ? fmt((dist.high / withHr) * 100) : '–'}%</dd>
          <dt>Rustdagen</dt><dd>${dist.rest}</dd>
          ${dist.noHr ? `<dt>Zonder hartslag</dt><dd>${dist.noHr}</dd>` : ''}
        </dl>
      </div>
      <p class="small muted" style="margin: 10px 0 0;">Op basis van de gemiddelde hartslag per training, niet de tijd per hartslagzone. Grens = ${settings.thresholdPct}% van je max-HR (${settings.hrMax}).</p>
    </div>

    <div class="card stack">
      <h3 class="card-title" style="margin: 0;">Instellingen</h3>
      <div class="grid-3">
        <div><label class="lbl" for="setHrMax">Max-HR</label><input class="input" id="setHrMax" type="number" inputmode="numeric" value="${settings.hrMax}"></div>
        <div><label class="lbl" for="setHrRest">Rust-HR</label><input class="input" id="setHrRest" type="number" inputmode="numeric" placeholder="${hrRest} (auto)" value="${settings.hrRest ?? ''}"></div>
        <div><label class="lbl" for="setThr">Grens %</label><input class="input" id="setThr" type="number" inputmode="numeric" value="${settings.thresholdPct}"></div>
      </div>
      <p class="small muted" style="margin: 0;">Rust-HR leeg = mediaan van je ochtend-HR (nu ${hrRest}). ${metric === 'trimp' && estimated ? `${estimated} van de ${recent.length} trainingen van de laatste 90 dagen hebben geen hartslag; hun TRIMP is geschat.` : ''}</p>
    </div>`;

  // Bediening
  el.querySelectorAll('button[data-metric]').forEach((b) => { b.onclick = () => { ss.set('sense.trMetric', b.dataset.metric); setTrainingSetting('metric', b.dataset.metric); renderTraining(el, toggle).then(() => rebind(el, toggle)); }; });
  el.querySelectorAll('button[data-range]').forEach((b) => { b.onclick = () => { ss.set('sense.trRange', Number(b.dataset.range)); renderTraining(el, toggle).then(() => rebind(el, toggle)); }; });
  el.querySelector('#trSumMode').onchange = (e) => { ss.set('sense.trSumMode', e.target.value); renderTraining(el, toggle).then(() => rebind(el, toggle)); };
  el.querySelector('#trSport').onchange = (e) => { ss.set('sense.trSport', e.target.value); renderTraining(el, toggle).then(() => rebind(el, toggle)); };
  const saveNum = (id, key, min, max, allowEmpty) => {
    el.querySelector(id).onchange = (e) => {
      const v = e.target.value === '' ? null : Number(e.target.value);
      if (v == null ? !allowEmpty : !(v >= min && v <= max)) return;
      setTrainingSetting(key, v);
      renderTraining(el, toggle).then(() => rebind(el, toggle));
    };
  };
  saveNum('#setHrMax', 'hrMax', 120, 230, false);
  saveNum('#setHrRest', 'hrRest', 30, 100, true);
  saveNum('#setThr', 'thresholdPct', 50, 95, false);

  // Grafieken
  const labels = slice.map((d) => short(d.date));
  const pr = (n) => (slice.length > 120 ? 0 : n);
  mountChart(el.querySelector('#chLoad'), {
    type: 'line',
    data: { labels, datasets: [
      { data: slice.map((d) => d.ctl), borderColor: C.accent, borderWidth: 2, pointRadius: pr(0), tension: 0.2 },
      { data: slice.map((d) => d.atl), borderColor: '#b49be6', borderWidth: 1.5, pointRadius: pr(0), tension: 0.2 },
    ] },
    options: axisOpts({ beginAtZero: true }),
  });
  mountChart(el.querySelector('#chForm'), {
    type: 'bar',
    data: { labels, datasets: [{ data: slice.map((d) => d.form), backgroundColor: slice.map((d) => (d.form >= 0 ? C.olive : '#f59e5b')), barPercentage: 1, categoryPercentage: 1 }] },
    options: axisOpts(),
  });
  mountChart(el.querySelector('#chRisk'), {
    type: 'bar',
    data: { labels, datasets: [{ data: slice.map((d) => d.ratio), backgroundColor: slice.map((d) => RISK_INFO[riskZone(d.ratio)]?.color || 'transparent'), barPercentage: 1, categoryPercentage: 1 }] },
    options: axisOpts({ suggestedMin: 0, suggestedMax: 1.6 }),
  });
  mountChart(el.querySelector('#chSum'), {
    type: 'bar',
    data: { labels: sums.map((s) => s.label), datasets: [{ data: sums.map((s) => Math.round(s.total)), backgroundColor: sums.map((_, i) => (i === sums.length - 1 ? C.accent : C.band)), borderRadius: { topLeft: 2, topRight: 2 }, borderSkipped: 'bottom' }] },
    options: axisOpts({ beginAtZero: true }),
    plugins: [{
      id: 'vals',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save(); ctx.fillStyle = '#e7e5e4'; ctx.font = '10px Inter, system-ui'; ctx.textAlign = 'center';
        chart.getDatasetMeta(0).data.forEach((b, i) => ctx.fillText(Math.round(sums[i].total), b.x, b.y - 4));
        ctx.restore();
      },
    }],
  });
  mountChart(el.querySelector('#chInt'), {
    type: 'doughnut',
    data: { labels: ['Licht', 'Zwaar'], datasets: [{ data: withHr ? [dist.low, dist.high] : [1], backgroundColor: withHr ? [C.olive, C.accent] : [C.line], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { enabled: false } } },
  });
}

// De HRV/Training-schakelaar zit in trends.js; na een herrender opnieuw koppelen.
function rebind(el) {
  el.querySelectorAll('button[data-tmode]').forEach((b) => {
    b.onclick = () => { try { localStorage.setItem('sense.trendsMode', JSON.stringify(b.dataset.tmode)); } catch { /* */ } window.dispatchEvent(new CustomEvent('sense:navigate', { detail: 'trends' })); };
  });
}
