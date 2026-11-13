// Schermen Vandaag, Historiek en Meer.

import { $, esc, notify, confirmDialog, isoDate, addDays, niceDate, longDate, dayShort, monthName, parseIso, fmtHours } from './util.js';
import { getAll, getDay, deleteDay, clearAll, count, isPersisted, requestPersist } from './db.js';
import { openTags, TRAINING, ALCOHOL, customTagNames, setCustomTagNames } from './tags.js';
import { loadMeasurement } from './measure.js';
import { loadSeries, lastMeasuredIndex, valueColor, adviceCard, renderWeek } from './trends.js';
import { advice, readinessAdvice, baselineArrow, CATEGORY_LABEL } from './analytics.js';
import { parseHrv4Training, importRecords, exportBackup, parseBackup, restoreBackup, exportCsv } from './importexport.js';

const go = (view) => window.dispatchEvent(new CustomEvent('sense:navigate', { detail: view }));
const fmt = (v, d = 0) => (v == null ? '–' : Number(v).toFixed(d));

// ================= VANDAAG =================
export async function renderToday() {
  const el = $('view-vandaag');
  const { days } = await loadSeries();
  const li = lastMeasuredIndex(days);
  if (li < 0) {
    el.innerHTML = `<div class="hero"><span class="small muted">rMSSD vanochtend</span><span class="hero-empty">–</span>
      <span class="small muted">Nog geen metingen opgeslagen</span></div>
      <div class="card stack">
        <button class="btn btn-primary btn-block" data-go="meten">Eerste meting starten</button>
        <button class="btn btn-block" data-go="meer">HRV4Training-geschiedenis importeren</button>
      </div>`;
    bindGo(el);
    return;
  }
  const today = isoDate();
  const d = days[li];
  const last = d.rec;
  const isToday = d.date === today;
  const pillCls = d.category === 'below' ? 'pill-alert' : d.category ? 'pill-ok' : 'pill-muted';

  // Band-balk: schaal van band ± ruime marge
  const lo = d.bandLo, hi = d.bandHi;
  let bandHtml = '';
  if (lo != null) {
    const min = Math.min(lo - (hi - lo) * 0.7, d.rmssd - 3), max = Math.max(hi + (hi - lo) * 0.7, d.rmssd + 3);
    const pos = (v) => `${(((v - min) / (max - min)) * 100).toFixed(1)}%`;
    bandHtml = `<div style="padding: 0 6px;"><div class="bandbar"><div class="rng" style="left: ${pos(lo)}; width: calc(${pos(hi)} - ${pos(lo)});"></div><div class="dot" style="left: ${pos(d.rmssd)};"></div></div>
      <div class="bandbar-labels"><span style="left: ${pos(lo)}">${Math.round(lo)}</span><span style="left: ${pos(hi)}">${Math.round(hi)}</span></div></div>`;
  }
  const miniBand = (v, l, h) => {
    if (l == null || v == null) return '';
    const min = Math.min(l - (h - l), v - 1), max = Math.max(h + (h - l), v + 1);
    const pos = (x) => `${(((x - min) / (max - min)) * 100).toFixed(1)}%`;
    return `<div class="mini-band"><div class="rng" style="left: ${pos(l)}; width: calc(${pos(h)} - ${pos(l)});"></div><div class="dot" style="left: ${pos(v)};"></div></div>`;
  };

  // Staafjes: 7 kalenderdagen eindigend op vandaag
  const byIdx = new Map(days.map((x, i) => [x.date, i]));
  const dates = [];
  for (let i = 6; i >= 0; i--) dates.push(addDays(today, -i));
  const w = dates.map((dt) => days[byIdx.get(dt)] || { date: dt });
  const present = w.map((x) => x.rmssd).filter((v) => v != null);
  const vmin = Math.min(...present, lo ?? Infinity), vmax = Math.max(...present, hi ?? -Infinity);
  const floor = Math.max(0, vmin - (vmax - vmin) * 0.6 - 5);
  const h = (v) => (v == null ? 0 : Math.max(4, Math.round(((v - floor) / (vmax - floor || 1)) * 64)));

  const adv = advice(d);
  const t = last.tags || {};
  const filled = Object.values(t).some((v) => v != null && v !== '' && !(typeof v === 'object' && !Object.keys(v).length));
  el.innerHTML = `
    <div class="hero">
      <span class="small muted">${isToday ? 'rMSSD vanochtend' : `Laatste meting · ${esc(niceDate(d.date))}`}</span>
      <span class="hero-value">${Math.round(d.rmssd)}</span>
      <div class="row small muted" style="gap: 8px; flex-wrap: wrap; justify-content: center;">
        ${d.category ? `<span class="pill ${pillCls}">${esc(CATEGORY_LABEL[d.category])}</span>` : ''}
        <span>baseline ${fmt(d.baseline)} ${baselineArrow(days, li)}</span>
      </div>
    </div>
    ${bandHtml}
    <div class="grid-2">
      <div class="card"><div class="small muted">Hartslag</div><div class="num" style="font-size: 28px;">${fmt(d.hr)} <span class="unit">bpm</span></div>
        ${miniBand(d.hr, d.hrLo, d.hrHi)}
        <div class="small muted">${d.hrLo != null ? `band ${fmt(d.hrLo)}–${fmt(d.hrHi)} · bl ${fmt(d.hrBaseline)} ${baselineArrow(days, li, 'hrBaseline', 'hrSd60')}` : '&nbsp;'}</div></div>
      <div class="card"><div class="small muted">Extrasystolen</div><div class="num alert-text" style="font-size: 28px;">${fmt(last.extrasystolen)}</div>
        <div class="small muted">${last.measurement ? 'uitgefilterd' : last.source === 'hrv4t' ? 'uit HRV4Training' : '&nbsp;'}</div></div>
    </div>
    ${adviceCard(adv, isToday ? 'Advies vandaag' : `Advies ${niceDate(d.date)}`)}
    <button class="card readiness-mini" data-go="trends" style="width: 100%; text-align: left; border: 0; color: inherit;">
      <div class="between"><span class="small muted">Readiness-score</span><span class="small muted">Trends ›</span></div>
      <div class="row" style="gap: 10px; align-items: baseline;"><span class="num accent-text" style="font-size: 28px;">${fmt(d.readiness)}</span>
        <span class="small muted">${d.rdLo != null ? `band ${fmt(d.rdLo)}–${fmt(d.rdHi)}` : ''}</span></div>
      <div class="small" style="color: var(--text-2);">${esc(readinessAdvice(d)?.title || '')}</div>
    </button>
    <div class="card">
      <div class="between" style="margin-bottom: 10px;"><span class="small muted">Laatste 7 dagen</span><span class="small muted">week-gem. ${fmt(present.length ? present.reduce((a, b) => a + b, 0) / present.length : null)}</span></div>
      <div class="bars">
        ${w.map((x) => `<div class="bar-col"><span>${x.rmssd == null ? '' : Math.round(x.rmssd)}</span>
          <div class="bar" style="height: ${h(x.rmssd)}px; background: ${x.rmssd == null ? 'transparent' : valueColor(x, x.date === d.date)};"></div></div>`).join('')}
      </div>
      <div class="bar-labels">${dates.map((dt) => `<span>${dt === today ? 'vdg' : dayShort(dt)}</span>`).join('')}</div>
    </div>
    <div class="card">
      <div class="between"><span class="card-title" style="margin: 0;">Tags ${isToday ? 'vandaag' : esc(niceDate(d.date))}</span>
        <button class="btn btn-sm" id="todayTags">${filled ? 'Bewerken' : 'Invullen'}</button></div>
      ${tagSummary(t)}
    </div>
    ${!isToday ? '<button class="btn btn-primary btn-block" data-go="meten">Meting van vandaag starten</button>' : ''}`;
  bindGo(el);
  $('todayTags').onclick = () => openTags(d.date);
}

function tagSummary(t) {
  const items = [];
  if (t.sleepQuality != null) items.push(['Slaap', `${t.sleepQuality}/10${t.sleepHours != null ? ` · ${fmtHours(t.sleepHours)} u` : ''}`]);
  if (t.training) items.push(['Training', `${TRAINING.find(([v]) => v === t.training)?.[1] ?? t.training}${t.sport ? ` · ${t.sport}` : ''}${t.durationMin ? ` · ${t.durationMin} min` : ''}`]);
  if (t.motivation != null) items.push(['Motivatie', `${t.motivation}/10`]);
  if (t.mentalEnergy != null) items.push(['Mentale energie', `${t.mentalEnergy}/10`]);
  if (t.soreness != null) items.push(['Spierpijn', `${t.soreness}/10`]);
  if (t.fatigue != null) items.push(['Vermoeidheid', `${t.fatigue}/10`]);
  if (t.alcohol && t.alcohol !== 'nothing') items.push(['Alcohol', ALCOHOL.find(([v]) => v === t.alcohol)?.[1] ?? t.alcohol]);
  if (t.sick) items.push(['Ziek', 'ja']);
  for (const [k, v] of Object.entries(t.custom || {})) items.push([k, v]);
  if (!items.length) return '<p class="small muted" style="margin: 10px 0 0;">Nog niet ingevuld.</p>';
  return `<dl class="kv" style="margin: 12px 0 0;">${items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

function bindGo(root) {
  root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
}

// ================= HISTORIEK =================
const PAGE = 60;
let histShown = PAGE;

export async function renderHistory() {
  const el = $('view-historiek');
  const rows = (await getAll()).reverse();
  if (!rows.length) {
    el.innerHTML = '<h2 class="view-title">Historiek</h2><div class="card empty">Nog geen dagen opgeslagen.</div>';
    return;
  }
  let mode = 'week';
  try { mode = sessionStorage.getItem('sense.histMode') || 'week'; } catch { /* */ }
  const toggle = `<div class="seg-ctl view-toggle" role="group" aria-label="Weergave">
    <button type="button" data-mode="week" aria-pressed="${mode === 'week'}">Week</button>
    <button type="button" data-mode="list" aria-pressed="${mode === 'list'}">Lijst</button></div>`;
  const bindToggle = () => el.querySelectorAll('button[data-mode]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); try { sessionStorage.setItem('sense.histMode', b.dataset.mode); } catch { /* */ } renderHistory(); };
  });
  if (mode === 'week') {
    el.innerHTML = `<h2 class="view-title">Historiek</h2>${toggle}<div class="card" id="histWeek"></div>`;
    el.onclick = null;
    bindToggle();
    await renderWeek($('histWeek'), 0);
    return;
  }
  const shown = rows.slice(0, histShown);
  let html = `<h2 class="view-title">Historiek</h2>${toggle}<p class="small muted" style="margin: 0 4px 6px;">${rows.length} dagen</p>`;
  let month = '';
  for (const r of shown) {
    const m = `${monthName(r.date)} ${r.date.slice(0, 4)}`;
    if (m !== month) { month = m; html += `<div class="month">${esc(m)}</div>`; }
    const t = r.tags || {};
    const meta = [
      r.hr != null ? `HR ${Math.round(r.hr)}` : null,
      r.extrasystolen != null ? `ES ${r.extrasystolen}` : null,
      t.training && t.training !== 'rest' ? (t.sport || 'training') : null,
      t.sleepQuality != null ? `slaap ${t.sleepQuality}` : null,
    ].filter(Boolean).join(' · ');
    html += `<button class="hist-item" data-date="${r.date}">
      <span class="hist-date"><b>${parseIso(r.date).getDate()}</b><span>${dayShort(r.date)}</span></span>
      <span><span class="hist-meta">${esc(meta) || '&nbsp;'}</span>${r.source === 'hrv4t' ? '<span class="src">H4T</span>' : r.measurement ? '<span class="src">Sense</span>' : ''}</span>
      <span class="hist-val"><span class="num">${r.rmssd == null ? '–' : Math.round(r.rmssd)}</span></span>
    </button>`;
  }
  if (rows.length > histShown) html += `<button class="btn btn-block" id="histMore">Meer laden (${rows.length - histShown})</button>`;
  el.innerHTML = html;
  bindToggle();
  el.onclick = (e) => {
    const b = e.target.closest('.hist-item');
    if (b) openDay(b.dataset.date);
  };
  const more = $('histMore');
  if (more) more.onclick = (e) => { e.stopPropagation(); histShown += PAGE * 3; renderHistory(); };
}

async function openDay(date) {
  const r = await getDay(date);
  if (!r) return;
  const t = r.tags || {};
  const sd = (await loadSeries()).byDate.get(date) || {};
  const adv = advice(sd);
  const sheet = $('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><button class="btn btn-sm btn-ghost" id="dayClose">Terug</button><span class="sheet-title"><b>Dag</b><span class="small muted">${esc(longDate(date))}</span></span><span style="width: 64px;"></span></div>
    <div class="hero" style="padding-top: 0;"><span class="small muted">rMSSD${r.time ? ` · ${esc(r.time)}` : ''}</span>
      <span class="hero-value" style="font-size: 72px;">${r.rmssd == null ? '–' : Math.round(r.rmssd)}</span>
      <span class="small muted">${r.source === 'hrv4t' ? 'Geïmporteerd uit HRV4Training' : 'Gemeten met Sense HRV'}</span></div>
    <div class="card"><dl class="kv" style="margin: 0;">
      <dt>Hartslag</dt><dd>${fmt(r.hr)} bpm</dd>
      <dt>Gem. RR (AVNN)</dt><dd>${fmt(r.avnn)} ms</dd>
      <dt>SDNN</dt><dd>${fmt(r.sdnn, 1)} ms</dd>
      <dt>pNN50</dt><dd>${fmt(r.pnn50, 1)} %</dd>
      <dt>Extrasystolen</dt><dd>${fmt(r.extrasystolen)}</dd>
      <dt>Baseline (7 d)</dt><dd>${fmt(sd.baseline)} ms</dd>
      <dt>Normale band</dt><dd>${sd.bandLo != null ? `${fmt(sd.bandLo)}–${fmt(sd.bandHi)} ms` : '–'}</dd>
      <dt>Categorie</dt><dd>${sd.category ? esc(CATEGORY_LABEL[sd.category]) : '–'}</dd>
      <dt>Genormaliseerde HRV</dt><dd>${fmt(sd.nhrv, 1)} ms</dd>
      <dt>Readiness-score</dt><dd>${fmt(sd.readiness)}</dd>
      ${r.measurement ? `<dt>Actieve duur</dt><dd>${fmt(r.measurement.duration)} s</dd>` : ''}
    </dl></div>
    ${adviceCard(adv, 'Advies Sense HRV')}
    ${r.advice ? `<div class="notice" style="background: var(--card);"><div><span class="small muted">Advies HRV4Training (geïmporteerd)</span><p>${esc(r.advice)}</p></div></div>` : ''}
    <div class="card"><div class="card-title" style="margin: 0;">Tags</div>${tagSummary(t)}${t.note ? `<p style="margin: 12px 0 0;">${esc(t.note)}</p>` : ''}</div>
    <button class="btn btn-block" id="dayTags">Tags bewerken</button>
    ${r.measurement ? '<button class="btn btn-block" id="dayReanalyse">Opnieuw filteren</button>' : ''}
    <button class="btn btn-danger btn-block" id="dayDelete">Dag verwijderen</button>
  </div>`;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; };
  sheet.onclick = null;
  sheet.oninput = null;
  $('dayClose').onclick = close;
  $('dayTags').onclick = () => openTags(date);
  if (r.measurement) $('dayReanalyse').onclick = () => { close(); go('meten'); loadMeasurement(r); notify('Meting geopend', 'Pas de segmenten aan en sla opnieuw op'); };
  $('dayDelete').onclick = async () => {
    if (!(await confirmDialog('Dag verwijderen?', `${longDate(date)} wordt definitief verwijderd.`, 'Verwijderen', true))) return;
    await deleteDay(date);
    close();
    notify('Verwijderd', longDate(date));
    window.dispatchEvent(new CustomEvent('sense:data'));
  };
}

// ================= MEER =================
export async function renderMore() {
  const el = $('view-meer');
  const n = await count();
  const persisted = await isPersisted();
  el.innerHTML = `
    <h2 class="view-title">Meer</h2>
    <div class="card stack">
      <div class="card-title" style="margin: 0;">Importeren</div>
      <p class="small muted" style="margin: 0;">HRV4Training-export (CSV). Bestaande Sense-metingen worden nooit overschreven; hun lege tags worden aangevuld.</p>
      <label class="btn btn-block file-label">HRV4Training-bestand kiezen<input type="file" id="impH4t" accept=".csv,.txt,.html,text/*"></label>
      <label class="btn btn-block file-label">Back-up terugzetten (JSON)<input type="file" id="impBackup" accept=".json,application/json"></label>
    </div>
    <div class="card stack">
      <div class="card-title" style="margin: 0;">Exporteren</div>
      <button class="btn btn-block" id="expBackup">Back-up downloaden (JSON, met ruwe data)</button>
      <button class="btn btn-block" id="expCsv">Tabel downloaden (CSV voor Excel)</button>
    </div>
    <div class="card stack">
      <div class="card-title" style="margin: 0;">Eigen tags</div>
      <p class="small muted" style="margin: 0;">Namen gescheiden door komma's. Extrasystolen is een vast veld.</p>
      <input class="input" id="customTags" value="${esc(customTagNames().join(', '))}" aria-label="Eigen tags">
      <button class="btn btn-block" id="saveCustom">Bewaren</button>
    </div>
    <div class="card stack">
      <div class="card-title" style="margin: 0;">Opslag</div>
      <dl class="kv" style="margin: 0;"><dt>Opgeslagen dagen</dt><dd>${n}</dd>
        <dt>Beschermd tegen opruimen</dt><dd>${persisted ? 'ja' : 'nee'}</dd></dl>
      <p class="small muted" style="margin: 0;">Je data staat alleen op dit toestel, in deze browser. Download regelmatig een back-up.</p>
      ${persisted ? '' : '<button class="btn btn-block" id="persistBtn">Opslag beschermen</button>'}
      <button class="btn btn-danger btn-block" id="wipe">Alle data wissen</button>
    </div>`;

  $('impH4t').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { records, skipped } = parseHrv4Training(await file.text());
      if (!(await confirmDialog('Importeren?', `${records.length} dagen gevonden${skipped ? `, ${skipped} regels overgeslagen` : ''}.`, 'Importeren'))) return;
      const res = await importRecords(records);
      await requestPersist();
      notify('Import klaar', `${res.added} nieuw · ${res.merged} bijgewerkt · ${res.keptOwn} eigen metingen behouden`);
      window.dispatchEvent(new CustomEvent('sense:data'));
    } catch (err) {
      notify('Import mislukt', err.message);
    }
  };
  $('impBackup').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const days = parseBackup(await file.text());
      if (!(await confirmDialog('Back-up terugzetten?', `${days.length} dagen. Dagen die ook in de back-up staan worden vervangen.`, 'Terugzetten', true))) return;
      await restoreBackup(days);
      notify('Back-up teruggezet', `${days.length} dagen`);
      window.dispatchEvent(new CustomEvent('sense:data'));
    } catch (err) {
      notify('Terugzetten mislukt', err.message);
    }
  };
  $('expBackup').onclick = async () => notify('Back-up gedownload', `${await exportBackup()} dagen`);
  $('expCsv').onclick = async () => notify('CSV gedownload', `${await exportCsv()} dagen`);
  $('saveCustom').onclick = () => {
    const list = $('customTags').value.split(',').map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== 'extrasystolen');
    setCustomTagNames([...new Set(list)]);
    notify('Eigen tags bewaard', list.join(', ') || 'geen');
  };
  const pb = $('persistBtn');
  if (pb) pb.onclick = async () => { notify((await requestPersist()) ? 'Opslag beschermd' : 'Niet gelukt', 'Installeer de app op je startscherm voor de beste kans'); renderMore(); };
  $('wipe').onclick = async () => {
    if (!(await confirmDialog('Alle data wissen?', 'Dit kan niet ongedaan worden. Download eerst een back-up.', 'Alles wissen', true))) return;
    await clearAll();
    notify('Alle data gewist');
    window.dispatchEvent(new CustomEvent('sense:data'));
  };
}
