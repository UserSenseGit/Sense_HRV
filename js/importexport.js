// Import van de HRV4Training-export (CSV) en back-up/export van eigen data.

import { getAll, putMany } from './db.js';
import { isoDate, download } from './util.js';

const num = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => { const s = (v ?? '').trim(); return s === '' ? null : s; };
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** HRV4Training gebruikt JJJJ-DD-MM. */
function parseH4tDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const [, y, d, mo] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo}-${d}`;
}
/** 'hh:mm' naar uren. */
function hmToHours(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
  return m ? Math.round((Number(m[1]) + Number(m[2]) / 60) * 100) / 100 : null;
}
const TRAINING = { rest: 'rest', easy: 'easy', average: 'average', intense: 'intense' };
const ALCOHOL = { nothing: 'nothing', 'a little': 'little', 'too much': 'toomuch' };
const SPORT = {
  Biking: 'Fietsen', Running: 'Lopen', Walking: 'Wandelen', Swimming: 'Zwemmen', Strength: 'Kracht', Weightlifting: 'Kracht',
  Elliptical: 'Crosstrainer', Hiking: 'Wandelen', Skiing: 'Skiën', 'Running-Biking': 'Lopen + fietsen', '* Running-Biking *': 'Lopen + fietsen', '* Other *': 'Anders',
};

/**
 * Leest de tekst van een HRV4Training-export. Geeft { records, skipped }.
 * Kolommen worden op naam opgezocht, dus een andere volgorde is geen probleem.
 */
export function parseHrv4Training(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) throw new Error('Leeg bestand');
  const head = lines[0].split(',').map((h) => h.trim());
  const col = (name) => head.indexOf(name);
  if (col('rMSSD') < 0 || col('local') < 0) throw new Error('Dit lijkt geen HRV4Training-export (kolommen rMSSD/local ontbreken)');
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const records = [];
  let skipped = 0;

  for (let li = 1; li < lines.length; li++) {
    const f = lines[li].split(',');
    const g = (name) => (idx[name] == null ? undefined : f[idx[name]]);
    const date = parseH4tDate(g('local')) || parseH4tDate(g('date'));
    if (!date) { skipped++; continue; }

    const custom = {};
    let extrasystolen = null;
    for (const n of [1, 2, 3]) {
      const name = str(g(`custom_tag_${n}_name`));
      const val = num(g(`custom_tag_${n}_value`));
      if (!name || val == null) continue;
      if (name.toLowerCase() === 'extrasystolen') extrasystolen = val;
      else custom[name] = val;
    }

    const training = TRAINING[str(g('training'))] || null;
    const dist = num(g('trainingDistance'));
    const time = num(g('trainingTime'));
    const sportRaw = str(g('training_type'));
    const sick = str(g('sickness'));
    const trav = str(g('traveling'));
    const bed = str(g('sleep_tobed'));
    const wake = str(g('sleep_awake'));

    const tags = {
      sleepQuality: num(g('sleep_quality')),
      bedTime: bed,
      wakeTime: wake,
      sleepHours: hmToHours(g('sleep_time')),
      training,
      sport: training && training !== 'rest' ? (SPORT[sportRaw] || sportRaw) : null,
      rpe: num(g('trainingRPE')),
      durationMin: time != null ? Math.round(time / 60) : null,
      distanceKm: dist != null ? r1(dist / 1000) : null,
      performance: num(g('training_performance')),
      motivation: num(g('trainingMotivation')),
      mentalEnergy: num(g('mental_energy')),
      soreness: num(g('muscle_soreness')),
      fatigue: num(g('fatigue')),
      physicalCondition: num(g('physical_condition')),
      lifestyleStress: num(g('lifestyle')),
      alcohol: ALCOHOL[str(g('alcohol'))] ?? null,
      sick: sick == null ? null : sick === 'sick',
      traveling: trav == null ? null : trav === 'traveling',
      note: str(g('note')),
      custom,
    };

    records.push({
      date,
      time: str(g('time')),
      source: 'hrv4t',
      hr: num(g('HR')),
      rmssd: num(g('rMSSD')),
      avnn: r1(num(g('AVNN'))),
      sdnn: num(g('SDNN')),
      pnn50: num(g('pNN50')),
      extrasystolen,
      measurement: null,
      tags,
      advice: str(g('daily_message')),
    });
  }
  return { records, skipped };
}

/**
 * Voegt geïmporteerde records samen met wat er al is.
 * Een eigen Sense-meting (met ruwe data) wordt nooit overschreven; ontbrekende tags worden aangevuld.
 */
export async function importRecords(incoming) {
  const existing = new Map((await getAll()).map((r) => [r.date, r]));
  const out = [];
  let added = 0, merged = 0, keptOwn = 0;
  for (const rec of incoming) {
    const old = existing.get(rec.date);
    if (!old) { out.push(rec); added++; continue; }
    if (old.measurement) {
      // Eigen meting behouden, alleen lege tags aanvullen.
      const tags = { ...(rec.tags || {}), ...Object.fromEntries(Object.entries(old.tags || {}).filter(([, v]) => v != null)) };
      tags.custom = { ...(rec.tags?.custom || {}), ...(old.tags?.custom || {}) };
      out.push({ ...old, tags, advice: old.advice ?? rec.advice, extrasystolen: old.extrasystolen ?? rec.extrasystolen });
      keptOwn++;
    } else {
      out.push({ ...old, ...rec, createdAt: old.createdAt });
      merged++;
    }
  }
  await putMany(out);
  return { added, merged, keptOwn };
}

// ---- Back-up (JSON) ----
export async function exportBackup() {
  const rows = await getAll();
  const payload = { app: 'sense-hrv', version: 1, exportedAt: new Date().toISOString(), days: rows };
  download(`sense-hrv-backup-${isoDate()}.json`, JSON.stringify(payload));
  return rows.length;
}

export function parseBackup(text) {
  const obj = JSON.parse(text);
  if (obj?.app !== 'sense-hrv' || !Array.isArray(obj.days)) throw new Error('Geen Sense HRV-back-up');
  return obj.days.filter((d) => typeof d?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date));
}

/** Back-up terugzetten: records uit het bestand vervangen dezelfde dagen. */
export async function restoreBackup(days) {
  await putMany(days);
  return days.length;
}

// ---- CSV-export (voor Excel e.d.) ----
const CSV_COLS = [
  ['datum', (r) => r.date], ['tijd', (r) => r.time], ['bron', (r) => r.source],
  ['hr', (r) => r.hr], ['rmssd', (r) => r.rmssd], ['avnn', (r) => r.avnn], ['sdnn', (r) => r.sdnn], ['pnn50', (r) => r.pnn50],
  ['extrasystolen', (r) => r.extrasystolen],
  ['slaapkwaliteit', (r) => r.tags?.sleepQuality], ['naar_bed', (r) => r.tags?.bedTime], ['opgestaan', (r) => r.tags?.wakeTime],
  ['uren_slaap', (r) => r.tags?.sleepHours], ['training', (r) => r.tags?.training], ['sport', (r) => r.tags?.sport],
  ['rpe', (r) => r.tags?.rpe], ['duur_min', (r) => r.tags?.durationMin], ['afstand_km', (r) => r.tags?.distanceKm],
  ['prestatie', (r) => r.tags?.performance], ['motivatie', (r) => r.tags?.motivation], ['mentale_energie', (r) => r.tags?.mentalEnergy],
  ['spierpijn', (r) => r.tags?.soreness], ['vermoeidheid', (r) => r.tags?.fatigue], ['alcohol', (r) => r.tags?.alcohol],
  ['ziek', (r) => r.tags?.sick], ['op_reis', (r) => r.tags?.traveling], ['notitie', (r) => r.tags?.note],
];
export async function exportCsv() {
  const rows = await getAll();
  const customNames = [...new Set(rows.flatMap((r) => Object.keys(r.tags?.custom || {})))];
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ','); // Excel (nl) verwacht een komma
    if (typeof v === 'boolean') return v ? 'ja' : 'nee';
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [...CSV_COLS.map((c) => c[0]), ...customNames].join(';');
  const body = rows.map((r) => [...CSV_COLS.map(([, f]) => cell(f(r))), ...customNames.map((n) => cell(r.tags?.custom?.[n]))].join(';'));
  download(`sense-hrv-${isoDate()}.csv`, [header, ...body].join('\n'), 'text/csv');
  return rows.length;
}
