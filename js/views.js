// Schermen Vandaag, Historiek en Meer.

import { $, esc, notify, confirmDialog, isoDate, addDays, niceDate, longDate, dayShort, monthName, parseIso, fmtHours } from './util.js';
import { getAll, getDay, deleteDay, clearAll, count, isPersisted, requestPersist } from './db.js';
import { openTags, TRAINING, ALCOHOL, customTagNames, setCustomTagNames } from './tags.js';
import { loadMeasurement } from './measure.js';
import { parseHrv4Training, importRecords, exportBackup, parseBackup, restoreBackup, exportCsv } from './importexport.js';

const go = (view) => window.dispatchEvent(new CustomEvent('sense:navigate', { detail: view }));
const fmt = (v, d = 0) => (v == null ? '–' : Number(v).toFixed(d));

// ================= VANDAAG =================
export async function renderToday() {
  const el = $('view-vandaag');
  const rows = await getAll();
  const withHrv = rows.filter((r) => r.rmssd != null);
  const today = isoDate();
  const last = withHrv[withHrv.length - 1];

  if (!last) {
    el.innerHTML = `<div class="hero"><span class="small muted">rMSSD vanochtend</span><span class="hero-empty">–</span>
      <span class="small muted">Nog geen metingen opgeslagen</span></div>
      <div class="card stack">
        <button class="btn btn-primary btn-block" data-go="meten">Eerste meting starten</button>
        <button class="btn btn-block" data-go="meer">HRV4Training-geschiedenis importeren</button>
      </div>`;
    bindGo(el);
    return;
  }

  const isToday = last.date === today;
  // Week-gemiddelde: metingen van de laatste 7 kalenderdagen t.e.m. de laatste meting
  const from = addDays(last.date, -6);
  const week = withHrv.filter((r) => r.date >= from && r.date <= last.date);
  const weekAvg = week.reduce((a, r) => a + r.rmssd, 0) / week.length;

  // Staafjes: 7 kalenderdagen eindigend op vandaag
  const byDate = new Map(withHrv.map((r) => [r.date, r]));
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
  const vals = days.map((d) => byDate.get(d)?.rmssd ?? null);
  const present = vals.filter((v) => v != null);
  const lo = present.length ? Math.min(...present) : 0, hi = present.length ? Math.max(...present) : 1;
  const floor = Math.max(0, lo - (hi - lo) * 0.6 - 5);
  const h = (v) => (v == null ? 0 : Math.max(4, Math.round(((v - floor) / (hi - floor || 1)) * 64)));

  const t = last.tags || {};
  el.innerHTML = `
    <div class="hero">
      <span class="small muted">${isToday ? 'rMSSD vanochtend' : `Laatste meting · ${esc(niceDate(last.date))}`}</span>
      <span class="hero-value">${Math.round(last.rmssd)}</span>
      <span class="small muted">ms · week-gem. ${weekAvg.toFixed(0)} (${week.length} ${week.length === 1 ? 'meting' : 'metingen'})</span>
    </div>
    <div class="grid-2">
      <div class="card"><div class="small muted">Hartslag</div><div class="num" style="font-size: 28px;">${fmt(last.hr)} <span class="unit">bpm</span></div>
        <div class="small muted">${last.avnn ? `gem. RR ${fmt(last.avnn)} ms` : '&nbsp;'}</div></div>
      <div class="card"><div class="small muted">Extrasystolen</div><div class="num alert-text" style="font-size: 28px;">${fmt(last.extrasystolen)}</div>
        <div class="small muted">${last.measurement ? 'uitgefilterd' : last.source === 'hrv4t' ? 'uit HRV4Training' : '&nbsp;'}</div></div>
    </div>
    ${last.advice && isToday ? `<div class="notice"><div><b>Advies HRV4Training</b><p>${esc(last.advice)}</p></div></div>` : ''}
    <div class="card">
      <div class="between" style="margin-bottom: 10px;"><span class="small muted">Laatste 7 dagen</span><span class="small muted">rMSSD</span></div>
      <div class="bars">
        ${days.map((d, i) => `<div class="bar-col"><span>${vals[i] == null ? '' : Math.round(vals[i])}</span>
          <div class="bar ${vals[i] == null ? 'none' : d === last.date ? 'today' : ''}" style="height: ${h(vals[i])}px"></div></div>`).join('')}
      </div>
      <div class="bar-labels">${days.map((d) => `<span>${d === today ? 'vdg' : dayShort(d)}</span>`).join('')}</div>
    </div>
    <div class="card">
      <div class="between"><span class="card-title" style="margin: 0;">Tags ${isToday ? 'vandaag' : esc(niceDate(last.date))}</span>
        <button class="btn btn-sm" id="todayTags">${Object.values(t).some((v) => v != null && v !== '' && !(typeof v === 'object' && !Object.keys(v).length)) ? 'Bewerken' : 'Invullen'}</button></div>
      ${tagSummary(t)}
    </div>
    ${!isToday ? '<button class="btn btn-primary btn-block" data-go="meten">Meting van vandaag starten</button>' : ''}
    <p class="small muted" style="text-align: center; margin: 4px 0 0;">Baseline, normale band, advies en readiness-score volgen in fase 2.</p>`;
  bindGo(el);
  $('todayTags').onclick = () => openTags(last.date);
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
  const shown = rows.slice(0, histShown);
  let html = `<h2 class="view-title">Historiek</h2><p class="small muted" style="margin: 0 4px 6px;">${rows.length} dagen</p>`;
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
      ${r.measurement ? `<dt>Actieve duur</dt><dd>${fmt(r.measurement.duration)} s</dd>` : ''}
    </dl></div>
    ${r.advice ? `<div class="notice"><div><b>Advies HRV4Training</b><p>${esc(r.advice)}</p></div></div>` : ''}
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
