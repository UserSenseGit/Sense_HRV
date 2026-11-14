// Trainingsbelasting (fase 3): sessies, belasting per dag, CTL/ATL, readiness, blessurerisico,
// week/maand-overzichten en intensiteitsverdeling.
//
// Belastingsmaten:
// - duur      : minuten
// - afstand   : km
// - srpe      : minuten × RPE (Foster). Ontbrekende RPE → afgeleid van het trainingstype.
// - trimp     : Banister-TRIMP (man): min × HRr × 0,64 × e^(1,92 × HRr), HRr = (HRgem − HRrust)/(HRmax − HRrust).
//               Zonder gemiddelde hartslag: geschat met de mediane TRIMP/min van je eigen trainingen
//               van hetzelfde type (licht/gemiddeld/zwaar). Zo'n sessie telt als 'geschat'.
// CTL = exponentieel gewogen gemiddelde over 42 dagen, ATL over 7 dagen (dagelijkse update
// x_t = x_{t-1} + (belasting_t − x_{t-1}) / N). Readiness = CTL − ATL. Verhouding = ATL / CTL.

import { addDays, isoDate } from './util.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};

export const LOAD_METRICS = {
  trimp: { label: 'TRIMP (hartslag)', unit: '' },
  srpe: { label: 'Duur × RPE', unit: '' },
  duration: { label: 'Duur', unit: 'min' },
  distance: { label: 'Afstand', unit: 'km' },
};

export function trainingSettings() {
  return {
    hrMax: store.get('sense.hrMax', 181),
    hrRest: store.get('sense.hrRest', null), // null = automatisch uit ochtend-HR
    thresholdPct: store.get('sense.thresholdPct', 77),
    metric: store.get('sense.loadMetric', 'trimp'),
  };
}
export function setTrainingSetting(key, value) {
  const map = { hrMax: 'sense.hrMax', hrRest: 'sense.hrRest', thresholdPct: 'sense.thresholdPct', metric: 'sense.loadMetric' };
  store.set(map[key], value);
}

const RPE_FALLBACK = { easy: 3, average: 5, intense: 8 };

/** Rust-HR: instelling, anders mediaan van de ochtend-HR van de laatste 60 metingen. */
export function restingHr(records, settings = trainingSettings()) {
  if (settings.hrRest) return settings.hrRest;
  const hrs = records.filter((r) => r.hr != null).slice(-60).map((r) => r.hr).sort((a, b) => a - b);
  return hrs.length ? hrs[Math.floor(hrs.length / 2)] : 60;
}

export function trimpOf(minutes, avgHr, hrRest, hrMax) {
  if (!minutes || !avgHr || hrMax <= hrRest) return null;
  const x = Math.max(0, Math.min(1, (avgHr - hrRest) / (hrMax - hrRest)));
  return minutes * x * 0.64 * Math.exp(1.92 * x);
}

/**
 * Sessies uit de dagrecords. Geïmporteerde dagen (HRV4Training) bevatten de training van die dag zelf;
 * het Sense-formulier vraagt naar 'training gisteren', dus die sessie hoort bij de dag ervoor.
 */
/** Trainingstype afgeleid van de gemiddelde hartslag (voor activiteiten uit Intervals.icu). */
export function typeFromHr(avgHr, settings = trainingSettings()) {
  if (!avgHr) return 'average';
  const thr = (settings.hrMax * settings.thresholdPct) / 100;
  if (avgHr >= thr) return 'intense';
  if (avgHr < settings.hrMax * 0.6) return 'easy';
  return 'average';
}

export function sessionsFrom(records, settings = trainingSettings(), activities = []) {
  const hrRest = restingHr(records, settings);
  const out = [];
  // Activiteiten uit Intervals.icu gaan voor: op die dagen tellen de handmatige/geïmporteerde trainingen niet mee.
  const actDates = new Set(activities.map((a) => a.date));
  for (const a of activities) {
    const type = typeFromHr(a.avgHr, settings);
    out.push({
      date: a.date, type, sport: a.sport, durationMin: a.movingMin || 0, distanceKm: a.distanceKm || 0,
      rpe: a.rpe ?? RPE_FALLBACK[type], rpeEstimated: a.rpe == null, avgHr: a.avgHr ?? null,
      trimp: trimpOf(a.movingMin, a.avgHr, hrRest, settings.hrMax), source: 'intervals',
    });
  }
  for (const r of records) {
    const t = r.tags || {};
    if (!t.training || t.training === 'rest') continue;
    if (!t.durationMin && !t.distanceKm) continue;
    const date = r.source === 'hrv4t' ? r.date : addDays(r.date, -1);
    if (actDates.has(date)) continue;
    out.push({
      date,
      type: t.training,
      sport: t.sport || 'Anders',
      durationMin: t.durationMin || 0,
      distanceKm: t.distanceKm || 0,
      rpe: t.rpe ?? RPE_FALLBACK[t.training] ?? 5,
      rpeEstimated: t.rpe == null,
      avgHr: t.avgHr ?? null,
      trimp: trimpOf(t.durationMin, t.avgHr, hrRest, settings.hrMax),
    });
  }
  // TRIMP schatten voor sessies zonder hartslag: mediane TRIMP/min per type uit je eigen data
  const perType = {};
  for (const s of out) if (s.trimp != null && s.durationMin) (perType[s.type] ||= []).push(s.trimp / s.durationMin);
  const all = Object.values(perType).flat().sort((a, b) => a - b);
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  const fallback = med(all) ?? 0.7;
  for (const s of out) {
    if (s.trimp == null) {
      s.trimp = s.durationMin * (med(perType[s.type] || []) ?? fallback);
      s.trimpEstimated = true;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function loadOf(s, metric) {
  switch (metric) {
    case 'duration': return s.durationMin;
    case 'distance': return s.distanceKm;
    case 'srpe': return s.durationMin * s.rpe;
    default: return s.trimp;
  }
}

/** Belasting per kalenderdag + CTL/ATL/readiness/verhouding. */
export function loadSeries(sessions, metric, until = isoDate()) {
  if (!sessions.length) return [];
  const byDate = new Map();
  for (const s of sessions) byDate.set(s.date, (byDate.get(s.date) || 0) + (loadOf(s, metric) || 0));
  const days = [];
  let ctl = 0, atl = 0;
  const end = sessions[sessions.length - 1].date > until ? sessions[sessions.length - 1].date : until;
  for (let d = sessions[0].date; d <= end; d = addDays(d, 1)) {
    const load = byDate.get(d) || 0;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    days.push({ date: d, load, ctl, atl, form: ctl - atl, ratio: ctl > 0.01 ? atl / ctl : null });
  }
  return days;
}

export function riskZone(ratio) {
  if (ratio == null) return null;
  if (ratio < 0.8) return 'loss';
  if (ratio <= 1.3) return 'optimal';
  if (ratio <= 1.5) return 'moderate';
  return 'high';
}
export const RISK_INFO = {
  loss: { label: 'Verlies van fitheid', color: '#e8c547' },
  optimal: { label: 'Optimale belasting', color: '#759e0e' },
  moderate: { label: 'Verhoogd risico', color: '#f59e5b' },
  high: { label: 'Hoog risico', color: '#f87171' },
};

/** Totalen per periode (rolling 7 dagen of kalendermaand) voor één sport of alle. */
export function summaries(sessions, metric, { mode = 'week', sport = 'all', count = 8, until = isoDate() } = {}) {
  const ss = sport === 'all' ? sessions : sessions.filter((s) => s.sport === sport);
  const out = [];
  if (mode === 'week') {
    for (let i = count - 1; i >= 0; i--) {
      const end = addDays(until, -7 * i), start = addDays(end, -6);
      out.push({ label: `${end.slice(8, 10)}/${end.slice(5, 7)}`, start, end, total: ss.filter((s) => s.date >= start && s.date <= end).reduce((a, s) => a + (loadOf(s, metric) || 0), 0) });
    }
  } else {
    const [y, m] = until.split('-').map(Number);
    for (let i = count - 1; i >= 0; i--) {
      const dt = new Date(y, m - 1 - i, 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      out.push({ label: `${key.slice(5, 7)}/${key.slice(2, 4)}`, start: `${key}-01`, end: `${key}-31`, total: ss.filter((s) => s.date.startsWith(key)).reduce((a, s) => a + (loadOf(s, metric) || 0), 0) });
    }
  }
  return out;
}

/** Intensiteitsverdeling over de laatste `days` dagen op basis van de gemiddelde hartslag per sessie. */
export function intensity(sessions, threshold, days = 28, until = isoDate()) {
  const start = addDays(until, -(days - 1));
  const ss = sessions.filter((s) => s.date >= start && s.date <= until);
  const withHr = ss.filter((s) => s.avgHr != null);
  const low = withHr.filter((s) => s.avgHr < threshold).length;
  const high = withHr.length - low;
  const trainDays = new Set(ss.map((s) => s.date)).size;
  return { low, high, noHr: ss.length - withHr.length, rest: days - trainDays, sessions: ss.length };
}

export function sportsOf(sessions) {
  const c = {};
  for (const s of sessions) c[s.sport] = (c[s.sport] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
