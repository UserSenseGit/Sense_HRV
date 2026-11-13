// Trendberekeningen (fase 2). Alles is afgeleid van de opgeslagen dagrecords.
//
// Geijkt op de HRV4Training-export van de gebruiker (13/11/2026):
// - baseline        = gemiddelde rMSSD van de laatste 7 kalenderdagen (min. 3 metingen)       → 52,9 (H4T: 53)
// - normale band    = 60 dagen, gemiddelde ± 1 SD van ln(rMSSD), terug omgezet naar ms         → 42–60 (H4T: 42–59)
// - HR-band         = 60 dagen, gemiddelde ± 1 SD                                               → 55–61 (H4T: 55–61)
// - CV              = SD / gemiddelde van ln(rMSSD) over 7 dagen × 100                          → 4,6 % (H4T: 4,5 %)
// - HRV-categorie   = z van ln(rMSSD) t.o.v. 60 dagen: < −1 onder, ≤ 1 binnen, ≤ 1,5 iets boven,
//                     ≤ 2,5 boven, anders ongewoon hoog; z > 1,5 met negatief gevoel ook
//                     ongewoon hoog                                                              → 97 % gelijk aan H4T-adviezen
// - kleur dagadvies  = onder+negatief rood, onder+positief of binnen+negatief geel, anders groen → 88 % (60 d, webversie)
// - subjectieve trend = gemiddelde z (t.o.v. 60 dagen) van slaapkwaliteit, motivatie en spierpijn
//                     (omgekeerd), gewogen 70 % vandaag / 30 % vorige trend; negatief als < −0,3 → 87 % gelijk aan H4T-adviezen
// De indeling van de 14-dagentrend (gaat goed / stabiel / maladaptatie / opgestapelde vermoeidheid)
// is een eigen interpretatie: het algoritme van HRV4Training is niet openbaar.

import { addDays, isoDate } from './util.js';

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const nums = (a) => a.filter((v) => v != null && Number.isFinite(v));

// ---- Parameters (gebruikt door subjectieve trend, heatmaps en readiness) ----
// better: +1 = hoger is beter, −1 = hoger is slechter
export const PARAMS = {
  hrv: { label: 'HRV', better: 1, get: (r) => r.rmssd },
  hr: { label: 'HR', better: -1, get: (r) => r.hr },
  sleepQuality: { label: 'Slaapkwaliteit', short: 'Slaap', better: 1, get: (r) => r.tags?.sleepQuality },
  sleepHours: { label: 'Uren slaap', better: 1, get: (r) => r.tags?.sleepHours },
  motivation: { label: 'Motivatie', better: 1, get: (r) => r.tags?.motivation },
  mentalEnergy: { label: 'Mentale energie', short: 'Energie', better: 1, get: (r) => r.tags?.mentalEnergy },
  soreness: { label: 'Spierpijn', better: -1, get: (r) => r.tags?.soreness },
  fatigue: { label: 'Vermoeidheid', better: -1, get: (r) => r.tags?.fatigue },
  extrasystolen: { label: 'Extrasystolen', short: 'ES', better: -1, get: (r) => r.extrasystolen },
};
export const DEFAULT_READINESS = ['hrv', 'hr', 'sleepQuality', 'soreness'];

/**
 * Bouwt een reeks per kalenderdag (van de eerste tot de laatste dag of tot vandaag)
 * met alle afgeleide waarden. Geeft { days: [...], byDate: Map }.
 */
export function buildSeries(records, { until = isoDate() } = {}) {
  if (!records.length) return { days: [], byDate: new Map() };
  const rec = new Map(records.map((r) => [r.date, r]));
  const first = records[0].date;
  const last = records[records.length - 1].date > until ? records[records.length - 1].date : until;
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const r = rec.get(d) || null;
    const rm = r?.rmssd ?? null;
    const avnn = r?.avnn ?? (r?.hr ? 60000 / r.hr : null);
    days.push({
      date: d,
      rec: r,
      rmssd: rm,
      ln: rm != null && rm > 0 ? Math.log(rm) : null,
      hr: r?.hr ?? null,
      nhrv: rm != null && avnn ? (rm / avnn) * 100 : null,
    });
  }
  const n = days.length;
  for (let i = 0; i < n; i++) {
    const d = days[i];
    const w7 = days.slice(Math.max(0, i - 6), i + 1);
    const w60 = days.slice(Math.max(0, i - 59), i + 1);
    const r7 = nums(w7.map((x) => x.rmssd));
    const ln7 = nums(w7.map((x) => x.ln));
    const h7 = nums(w7.map((x) => x.hr));
    const n7 = nums(w7.map((x) => x.nhrv));
    d.baseline = r7.length >= 3 ? mean(r7) : null;
    d.hrBaseline = h7.length >= 3 ? mean(h7) : null;
    d.nhrvBaseline = n7.length >= 3 ? mean(n7) : null;
    d.cv = ln7.length >= 3 ? (sd(ln7) / mean(ln7)) * 100 : null;

    const ln60 = nums(w60.map((x) => x.ln));
    const h60 = nums(w60.map((x) => x.hr));
    const nh60 = nums(w60.map((x) => x.nhrv));
    const r60 = nums(w60.map((x) => x.rmssd));
    d.n60 = ln60.length;
    if (ln60.length >= 14) {
      const m = mean(ln60), s = sd(ln60);
      d.bandLo = Math.exp(m - s);
      d.bandHi = Math.exp(m + s);
      d.rSd60 = sd(r60);
      d.z = d.ln != null && s ? (d.ln - m) / s : null;
    }
    if (h60.length >= 14) {
      const m = mean(h60), s = sd(h60);
      d.hrLo = m - s; d.hrHi = m + s; d.hrSd60 = s;
    }
    if (nh60.length >= 14) {
      const m = mean(nh60), s = sd(nh60);
      d.nhrvLo = m - s; d.nhrvHi = m + s;
    }
    d.category = categorize(d.z);
  }
  // Subjectieve trend en z-scores per parameter (t.o.v. 60 dagen)
  const keys = Object.keys(PARAMS);
  for (let i = 0; i < n; i++) {
    const d = days[i];
    const w60 = days.slice(Math.max(0, i - 59), i + 1);
    d.pz = {};
    for (const k of keys) {
      const v = d.rec ? PARAMS[k].get(d.rec) : null;
      if (v == null) continue;
      const hist = nums(w60.map((x) => (x.rec ? PARAMS[k].get(x.rec) : null)));
      if (hist.length < 10) continue;
      const s = sd(hist);
      if (!s) { d.pz[k] = 0; continue; }
      const val = k === 'hrv' ? Math.log(v) : v;
      const h = k === 'hrv' ? hist.map(Math.log) : hist;
      d.pz[k] = Math.max(-3, Math.min(3, ((val - mean(h)) / sd(h)) * PARAMS[k].better));
    }
    const subj = ['sleepQuality', 'motivation', 'soreness'].map((k) => d.pz[k]).filter((v) => v != null);
    d.subjective = subj.length ? mean(subj) : null;
    // Trend = gewogen gemiddelde: vandaag 70 %, de trend van de vorige dagen 30 %.
    const prev = i > 0 ? days[i - 1].subjEwma : null;
    d.subjEwma = d.subjective == null ? prev ?? null : prev == null ? d.subjective : 0.7 * d.subjective + 0.3 * prev;
    d.subjTrend = d.subjective == null || d.subjEwma == null ? null : d.subjEwma < -0.3 ? 'neg' : 'pos';
    // Zoals HRV4Training: hoge HRV (z > 1,5) samen met een slecht gevoel geldt als 'ongewoon hoog'.
    if (d.z != null && d.z > 1.5 && d.subjTrend === 'neg') d.category = 'unusual';
  }
  return { days, byDate: new Map(days.map((d) => [d.date, d])) };
}

export function categorize(z) {
  if (z == null) return null;
  if (z < -1) return 'below';
  if (z <= 1) return 'within';
  if (z <= 1.5) return 'slight';
  if (z <= 2.5) return 'above';
  return 'unusual';
}
export const CATEGORY_LABEL = {
  below: 'onder normaal', within: 'binnen normaal', slight: 'iets boven normaal', above: 'boven normaal', unusual: 'ongewoon hoog',
};

/** Dagadvies, naar het model van HRV4Training. */
export function advice(d) {
  if (!d || d.rmssd == null) return null;
  if (d.rec?.tags?.sick) return { level: 'alert', title: 'Rust vandaag', text: 'Je gaf aan dat je ziek bent. Geef je lichaam de tijd om te herstellen.' };
  if (!d.category) return { level: 'muted', title: 'Nog te weinig data', text: `Voor een normale band zijn minstens 14 metingen in 60 dagen nodig (nu ${d.n60 || 0}).` };
  const neg = d.subjTrend === 'neg';
  const subj = d.subjTrend == null ? '' : neg ? ' maar je subjectieve scores dalen' : ' en je subjectieve scores zijn goed';
  switch (d.category) {
    case 'below':
      // Zoals HRV4Training: onder de band + goed gevoel = 'take it easy' (geel), + slecht gevoel = 'limit intensity' (rood).
      return neg
        ? { level: 'alert', title: 'Beperk intensiteit vandaag', text: `Je HRV ligt onder je normale band${subj}.` }
        : { level: 'warn', title: 'Doe het rustig aan', text: `Je HRV ligt onder je normale band${subj}.` };
    case 'within':
      return neg
        ? { level: 'warn', title: 'Doe het rustig aan', text: `Je HRV ligt binnen je normale band${subj}.` }
        : { level: 'ok', title: 'Ga verder zoals gepland', text: `Je HRV ligt binnen je normale band${subj}.` };
    case 'slight':
      return { level: neg ? 'warn' : 'ok', title: neg ? 'Luister naar je lichaam' : 'Ga verder zoals gepland', text: `Je HRV ligt iets boven je normale band${subj}.` };
    case 'above':
      return { level: neg ? 'warn' : 'ok', title: neg ? 'Luister naar je lichaam' : 'Ga verder zoals gepland', text: `Je HRV ligt boven je normale band${subj}.` };
    default:
      return { level: 'warn', title: 'Ongewoon hoge HRV', text: `Je HRV is ongewoon hoog${subj}. Dat kan wijzen op vermoeidheid of een beginnende ziekte.` };
  }
}

/** Richting van een baseline over `span` dagen, t.o.v. een drempel. */
function direction(now, before, thr) {
  if (now == null || before == null || thr == null) return null;
  const delta = now - before;
  return Math.abs(delta) < thr ? 'stable' : delta > 0 ? 'up' : 'down';
}

/**
 * 14-dagentrend op dag i (eigen interpretatie, zie bovenaan).
 * Drempels: 0,75 × SD(60 d) voor rMSSD en HR, 1,5 procentpunt voor CV.
 */
export function trendAt(days, i) {
  const d = days[i];
  const p = days[i - 14];
  if (!d || !p || d.n60 < 30) return null;
  const hrv = direction(d.baseline, p.baseline, d.rSd60 != null ? 0.75 * d.rSd60 : null);
  const hr = direction(d.hrBaseline, p.hrBaseline, d.hrSd60 != null ? 0.75 * d.hrSd60 : null);
  const cv = direction(d.cv, p.cv, 1.5);
  if (!hrv || !hr || !cv) return null;
  let key;
  if (hrv === 'down' && cv === 'down') key = 'fatigue';
  else if (hrv === 'down' && (hr === 'up' || cv === 'up')) key = 'maladaptation';
  else if (hrv !== 'down' && hr !== 'up') key = 'coping';
  else key = 'stable';
  return { key, hrv, hr, cv };
}
export const TREND_INFO = {
  coping: { label: 'Gaat goed om met training', tone: 'ok', text: 'Je fysiologische trends van de voorbije 14 dagen wijzen erop dat je je huidige belasting goed verwerkt.' },
  stable: { label: 'Stabiel', tone: 'muted', text: 'Gemengde signalen: geen duidelijke verbetering of verslechtering in de voorbije 14 dagen.' },
  maladaptation: { label: 'Maladaptatie', tone: 'warn', text: 'Je HRV-baseline daalt terwijl je hartslag of variatie stijgt. Overweeg wat minder belasting of meer herstel.' },
  fatigue: { label: 'Opgestapelde vermoeidheid', tone: 'alert', text: 'Je HRV-baseline daalt met een lagere variatie. Dat past bij opgestapelde vermoeidheid: plan herstel in.' },
};
export const DIR_LABEL = { up: 'Stijgend', down: 'Dalend', stable: 'Stabiel' };
export const DIR_ARROW = { up: '↗', down: '↘', stable: '→' };

/** Pijl voor de baseline op de startpagina: vandaag t.o.v. 7 dagen terug. */
export function baselineArrow(days, i, key = 'baseline', sdKey = 'rSd60') {
  const d = days[i], p = days[i - 7];
  if (!d || !p) return '→';
  const dir = direction(d[key], p[key], d[sdKey] != null ? 0.5 * d[sdKey] : null);
  return DIR_ARROW[dir || 'stable'];
}

/** Kleurklasse voor heatmap-cellen op basis van een z-score (positief = beter). */
export function heatClass(z) {
  if (z == null) return null;
  if (z <= -1) return 'much-worse';
  if (z <= -0.5) return 'worse';
  if (z < 0.5) return 'normal';
  if (z < 1) return 'better';
  return 'much-better';
}
export const HEAT_COLORS = {
  'much-worse': '#f87171', worse: '#f59e5b', normal: '#3a4352', better: '#759e0e', 'much-better': '#9cc33a',
};

// ---- Readiness-score (zoals de webversie: eigen keuze van 3–8 parameters) ----

/** Score 0–100 per dag: 50 + 50/3 × gemiddelde z van de gekozen parameters. */
export function readinessSeries(days, params) {
  for (const d of days) {
    const zs = params.map((k) => d.pz?.[k]).filter((v) => v != null);
    d.readiness = zs.length >= Math.min(2, params.length) ? Math.max(0, Math.min(100, 50 + (50 / 3) * mean(zs))) : null;
  }
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const w7 = nums(days.slice(Math.max(0, i - 6), i + 1).map((x) => x.readiness));
    const w60 = nums(days.slice(Math.max(0, i - 59), i + 1).map((x) => x.readiness));
    d.rdBaseline = w7.length >= 3 ? mean(w7) : null;
    if (w60.length >= 14) { const m = mean(w60), s = sd(w60); d.rdLo = m - s; d.rdHi = m + s; } else { d.rdLo = d.rdHi = null; }
  }
}
export function readinessAdvice(d) {
  if (d?.readiness == null) return null;
  if (d.rdLo == null) return { level: 'muted', title: 'Nog te weinig data', text: 'Minstens 14 dagen met deze parameters nodig.' };
  if (d.readiness < d.rdLo) return { level: 'warn', title: 'Doe het rustig aan', text: 'Je readiness-score ligt onder je normale band.' };
  if (d.readiness > d.rdHi) return { level: 'ok', title: 'Klaar om te presteren', text: 'Je readiness-score ligt boven je normale band.' };
  return { level: 'ok', title: 'Ga verder zoals gepland', text: 'Je readiness-score ligt binnen je normale band.' };
}

/** % verandering: gemiddelde laatste 7 dagen t.o.v. de 30 dagen daarvoor. */
export function weekVsMonth(days, i, key) {
  const cur = nums(days.slice(Math.max(0, i - 6), i + 1).map((x) => (x.rec ? PARAMS[key].get(x.rec) : null)));
  const prev = nums(days.slice(Math.max(0, i - 36), Math.max(0, i - 6)).map((x) => (x.rec ? PARAMS[key].get(x.rec) : null)));
  if (!cur.length || prev.length < 5) return null;
  const mp = mean(prev);
  if (!mp) return null;
  return ((mean(cur) - mp) / Math.abs(mp)) * 100;
}

export { mean, sd };
