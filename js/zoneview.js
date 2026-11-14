// Weergave van herstel, zones van vandaag en weekdoelen (gebruikt door Vandaag en Trends → Training).

import { esc, isoDate, addDays, niceDate } from './util.js';
import { getAll, getActivities } from './db.js';
import { buildSeries } from './analytics.js';
import { sessionsFrom, loadSeries as trainingLoad, trainingSettings } from './training.js';
import { buildZoneContext, weekStart, ZONE_COLORS, ZONE_LABELS, recoveryColor, recoveryLabel } from './zones.js';

export async function loadZoneContext() {
  const records = await getAll();
  const activities = await getActivities();
  const settings = trainingSettings();
  const { days } = buildSeries(records);
  const loads = trainingLoad(sessionsFrom(records, settings, activities), 'trimp');
  return { ctx: buildZoneContext(days, loads, activities, settings), hasActivities: activities.length > 0 };
}

const mins = (m) => `${Math.round(m)} min`;

/** Herstelscore en zones van een dag. */
export function zonesTodayHtml(ctx, date = isoDate()) {
  const z = ctx.zonesOn(date);
  const r = z.recovery;
  const span = z.max - z.low[0];
  const pct = (v) => `${(((v - z.low[0]) / span) * 100).toFixed(1)}%`;
  return `
    <div class="card">
      <div class="between"><span class="small muted">Herstel</span><span class="small muted">benadering Morpheus</span></div>
      <div class="row" style="gap: 10px; align-items: baseline;">
        <span class="num" style="font-size: 34px; color: ${recoveryColor(r)};">${r == null ? '–' : `${r}%`}</span>
        <span class="small" style="color: var(--text-2);">${esc(recoveryLabel(r))}</span>
      </div>
      <div class="zone-cols">
        ${['low', 'mod', 'high'].map((k) => `<div><span style="color: ${ZONE_COLORS[k]};">${ZONE_LABELS[k]}</span><b class="num">${z[k][0]}–${z[k][1]}</b></div>`).join('')}
      </div>
      <div class="zone-bar" aria-hidden="true">
        <i style="left: 0; width: ${pct(z.mod[0])}; background: ${ZONE_COLORS.low};"></i>
        <i style="left: ${pct(z.mod[0])}; width: calc(${pct(z.high[0])} - ${pct(z.mod[0])}); background: ${ZONE_COLORS.mod};"></i>
        <i style="left: ${pct(z.high[0])}; right: 0; background: ${ZONE_COLORS.high};"></i>
        <i class="z2" style="left: ${pct(z.z2[0])}; width: calc(${pct(z.z2[1] + 1)} - ${pct(z.z2[0])});"></i>
      </div>
      <div class="between small muted"><span>${z.low[0]}</span><span><b style="color: ${ZONE_COLORS.low};">Zone 2</b> ${z.z2[0]}–${z.z2[1]}</span><span>${z.max}</span></div>
      ${r == null ? '<p class="small muted" style="margin: 8px 0 0;">Nog geen meting voor deze dag: basiszones (75 % herstel).</p>' : ''}
    </div>`;
}

/** Weekdoelen met balkjes per zone. */
export function weekTargetsHtml(ctx, week, { nav = false, hasActivities = true } = {}) {
  const t = ctx.weekTotals(week);
  const tg = ctx.targets(week);
  const end = addDays(week, 6);
  const today = isoDate();
  const rows = ['low', 'mod', 'high'].map((k) => {
    const total = t[k];
    const [lo, hi] = tg ? tg[k] : [null, null];
    const scale = Math.max(total, hi ?? 0, 1) * 1.25;
    const p = (v) => `${Math.min(100, (v / scale) * 100).toFixed(1)}%`;
    const todayMin = week === weekStart(today) ? (t.byDay[today]?.[k] || 0) : 0;
    const done = lo != null && total >= lo;
    return `<div class="tg-row">
      <div class="between"><b>${ZONE_LABELS[k]}</b><span class="num">${mins(total)}${done ? ' <span style="color: var(--ok);" aria-label="doel gehaald">✓</span>' : ''}</span></div>
      <div class="tg-track">
        <i class="tg-fill" style="width: ${p(total - todayMin)}; background: ${ZONE_COLORS[k]};"></i>
        ${todayMin ? `<i class="tg-fill tg-today" style="left: ${p(total - todayMin)}; width: ${p(todayMin)}; background: ${ZONE_COLORS[k]};"></i>` : ''}
        ${lo != null ? `<i class="tg-band" style="left: ${p(lo)}; width: calc(${p(hi)} - ${p(lo)});"></i>` : ''}
      </div>
      ${lo != null ? `<div class="tg-labels"><span style="left: ${p(lo)};">${lo}</span><span style="left: ${p(hi)};">${hi}</span></div>` : ''}
    </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="between" style="margin-bottom: 6px;">
        ${nav ? '<button class="btn btn-sm" id="tgPrev" aria-label="Vorige week">‹</button>' : ''}
        <div style="text-align: ${nav ? 'center' : 'left'};"><div class="card-title" style="margin: 0;">Weekdoelen cardio</div>
          <div class="small muted">${esc(niceDate(week))} – ${esc(niceDate(end))}${week === weekStart(today) ? ` · nog ${Math.max(0, 6 - Math.round((new Date(today) - new Date(week)) / 864e5))} d` : ''}</div></div>
        ${nav ? `<button class="btn btn-sm" id="tgNext" aria-label="Volgende week" ${week >= weekStart(today) ? 'disabled' : ''}>›</button>` : ''}
      </div>
      ${rows}
      <p class="small muted" style="margin: 8px 0 0;">${!hasActivities ? 'Koppel Intervals.icu (Meer) om minuten per zone te tellen.'
        : tg ? `Doel = gemiddelde van de ${tg.basedOn} weken ervoor (ondergrens) tot ×1,5 / ×1,8 / ×3. Zone 2 deze week: ${mins(t.z2)}.`
          : 'Doelen verschijnen na 2 weken met hartslagdata.'}</p>
    </div>`;
}

export function bindWeekNav(root, ctx, week, opts, rerender) {
  const prev = root.querySelector('#tgPrev'), next = root.querySelector('#tgNext');
  if (prev) prev.onclick = () => rerender(addDays(week, -7));
  if (next) next.onclick = () => { if (week < weekStart(isoDate())) rerender(addDays(week, 7)); };
}
