// Herstelscore, hartslagzones van de dag en weekdoelen (naar het model van Morpheus).
//
// Zones (geijkt op 35 screenshots van Morpheus, 2021–2023):
// - laag begint bij 50 % van max-HR
// - start matig / hoog / zone 2 volgen een kwadratische curve in de herstelscore h (0–100);
//   in de periode met max-HR 181 wijkt die hooguit 0,9 / 1,8 / 0,4 bpm af van Morpheus
// - de basis (grenzen bij 75 % herstel) is instelbaar: Morpheus verschoof die na een nieuwe test
// Herstelscore: eigen benadering (gemiddeld ±10 punten van Morpheus op 10 vergelijkbare dagen).
// In de screenshots gaf een HRV binnen de range gemiddeld 85 %,
// onder of boven de range 46–50 % (afwijking in beide richtingen telt), rust-HR boven de range
// kostte extra punten. Trainingsbelasting (CTL−ATL) schuift de score licht.

import { addDays, isoDate, parseIso } from './util.js';
import { trainingSettings } from './training.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};

export const ZONE_COLORS = { low: '#38bdf8', mod: '#4ade80', high: '#f87171' };
export const ZONE_LABELS = { low: 'Laag', mod: 'Matig', high: 'Hoog' };

export function zoneSettings() {
  return { mod75: store.get('sense.zoneMod75', 138), high75: store.get('sense.zoneHigh75', 154) };
}
export function setZoneSetting(key, v) {
  store.set(key === 'mod75' ? 'sense.zoneMod75' : 'sense.zoneHigh75', v);
}

// Curves in bpm bij max-HR 181 (Morpheus, sept. 2022 – nov. 2023)
const poly = (a, b, c) => (h) => a * h * h + b * h + c;
const CURVE = {
  mod: poly(-0.002295, 0.720689, 97.327182),
  high: poly(0.000922, 0.282605, 126.955933),
  z2: poly(-0.001314, 0.449714, 95.053675),
};

/** Zones voor een herstelscore (null = geen meting: basis bij 75 %). */
export function zonesFor(recovery, settings = trainingSettings(), zs = zoneSettings()) {
  const h = recovery == null ? 75 : Math.max(0, Math.min(100, recovery));
  const k = settings.hrMax / 181;
  const shift = (c) => (c(h) - c(75)) * k;
  const lowStart = Math.round(settings.hrMax * 0.5);
  const mod = Math.round(zs.mod75 + shift(CURVE.mod));
  const high = Math.max(mod + 2, Math.round(zs.high75 + shift(CURVE.high)));
  const z2 = Math.min(mod - 1, Math.round((zs.mod75 * 121.39) / 138.47 + shift(CURVE.z2)));
  return {
    recovery: recovery == null ? null : Math.round(h),
    max: settings.hrMax,
    low: [lowStart, mod - 1], mod: [mod, high - 1], high: [high, settings.hrMax], z2: [z2, mod - 1],
  };
}

/**
 * Herstelscore 1–100 voor een dag uit de HRV-reeks (analytics.buildSeries) en de belastingsreeks.
 * Geeft null zonder meting of zonder normale band.
 */
export function recoveryScore(d, load) {
  if (!d || d.rmssd == null || d.z == null) return null;
  // HRV (z van ln rMSSD t.o.v. 60 dagen): onder de band iets zwaarder bestraft dan erboven
  let s = 100 - 25 * Math.max(0, -d.z) - 20 * Math.max(0, d.z);
  if (d.hr != null && d.hrHi != null && d.hr > d.hrHi) s -= 10;
  const sleep = d.rec?.tags?.sleepHours;
  if (sleep != null && sleep < 6) s -= 5;
  // trainingsbelasting pas meetellen als er genoeg geschiedenis is (CTL ≥ 15)
  if (load && load.ctl >= 15) s += Math.max(-8, Math.min(5, (10 * (load.ctl - load.atl)) / load.ctl));
  if (d.rec?.tags?.sick) s = Math.min(s, 30);
  return Math.max(1, Math.min(100, Math.round(s)));
}
export function recoveryColor(r) {
  if (r == null) return 'var(--muted)';
  if (r < 35) return '#f87171';
  if (r < 80) return '#facc15';
  return '#4ade80';
}
export function recoveryLabel(r) {
  if (r == null) return 'Geen meting';
  if (r >= 95) return 'Maximaal herstel';
  if (r >= 85) return 'Zeer goed herstel';
  if (r >= 80) return 'Goed herstel';
  if (r >= 70) return 'Matig herstel';
  if (r >= 60) return 'Laag herstel';
  return 'Zeer laag herstel';
}

// ---- Minuten per zone ----

/** Activiteit heeft nog een hartslagverdeling nodig (recent en met hartslag). */
export function needsHist(a) {
  return a.hrHist == null && a.avgHr != null && a.date >= addDays(isoDate(), -70);
}

export function zoneMinutes(hist, z) {
  const out = { low: 0, mod: 0, high: 0, z2: 0 };
  if (!hist) return null;
  for (const [bpm, sec] of Object.entries(hist)) {
    const b = Number(bpm);
    if (b >= z.high[0]) out.high += sec;
    else if (b >= z.mod[0]) out.mod += sec;
    else if (b >= z.low[0]) out.low += sec;
    if (b >= z.z2[0] && b <= z.z2[1]) out.z2 += sec;
  }
  for (const k of Object.keys(out)) out[k] /= 60;
  return out;
}

export function weekStart(iso) {
  const d = parseIso(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

/**
 * Bouwt een context: herstel en zones per dag, minuten per zone per activiteit en per week.
 * days = analytics.buildSeries(...).days, loads = training.loadSeries(...)
 */
export function buildZoneContext(days, loads, activities, settings = trainingSettings()) {
  const zs = zoneSettings();
  const loadBy = new Map(loads.map((l) => [l.date, l]));
  const dayBy = new Map(days.map((d) => [d.date, d]));
  const zonesOn = (date) => {
    const d = dayBy.get(date);
    // belasting van de dag ervoor: de ochtendmeting gebeurt vóór de training
    const r = recoveryScore(d, loadBy.get(addDays(date, -1)));
    return zonesFor(r, settings, zs);
  };
  const perAct = new Map();
  const weeks = new Map();
  let firstWeek = null;
  for (const a of activities) {
    if (!a.hrHist) continue;
    const z = zonesOn(a.date);
    const m = zoneMinutes(a.hrHist, z);
    perAct.set(a.id, { ...m, zones: z });
    const w = weekStart(a.date);
    if (!firstWeek || w < firstWeek) firstWeek = w;
    const t = weeks.get(w) || { low: 0, mod: 0, high: 0, z2: 0, byDay: {} };
    for (const k of ['low', 'mod', 'high', 'z2']) t[k] += m[k];
    const day = (t.byDay[a.date] ||= { low: 0, mod: 0, high: 0 });
    for (const k of ['low', 'mod', 'high']) day[k] += m[k];
    weeks.set(w, t);
  }
  const weekTotals = (w) => weeks.get(w) || { low: 0, mod: 0, high: 0, z2: 0, byDay: {} };
  /** Doelen voor week w: gemiddelde van de 4 weken ervoor (minstens 2 weken met zonedata). */
  const targets = (w) => {
    if (!firstWeek) return null;
    const prev = [1, 2, 3, 4].map((i) => addDays(w, -7 * i)).filter((x) => x >= firstWeek);
    if (prev.length < 2) return null;
    const avg = (k) => prev.reduce((s, x) => s + weekTotals(x)[k], 0) / prev.length;
    const lo = { low: avg('low'), mod: avg('mod'), high: Math.max(3, avg('high')) };
    return {
      low: [Math.round(lo.low), Math.round(lo.low * 1.5)],
      mod: [Math.round(lo.mod), Math.round(lo.mod * 1.8)],
      high: [Math.round(lo.high), Math.round(Math.max(lo.high * 3, lo.high + 6))],
      basedOn: prev.length,
    };
  };
  return { zonesOn, perAct, weekTotals, targets, firstWeek, recoveryOn: (date) => zonesOn(date).recovery };
}
