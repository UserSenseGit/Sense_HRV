// Koppeling met Intervals.icu: activiteiten ophalen via de eigen Vercel-functie (/api/intervals).
// Athlete-ID en API-sleutel blijven op dit toestel (localStorage).

import { isoDate, addDays } from './util.js';
import { putActivities, getActivities } from './db.js';

const K = { id: 'sense.icu.athlete', key: 'sense.icu.key', last: 'sense.icu.lastSync' };
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } };

export function icuConfig() {
  return { athleteId: get(K.id), apiKey: get(K.key), lastSync: get(K.last) };
}
export const icuConnected = () => !!(get(K.id) && get(K.key));
export function icuSave(athleteId, apiKey) {
  set(K.id, athleteId.trim());
  set(K.key, apiKey.trim());
}
export function icuDisconnect() {
  set(K.id, null); set(K.key, null); set(K.last, null);
}

const SPORT = {
  Ride: 'Fietsen', VirtualRide: 'Fietsen', EBikeRide: 'Fietsen', GravelRide: 'Fietsen', MountainBikeRide: 'Fietsen', EMountainBikeRide: 'Fietsen', Velomobile: 'Fietsen', Handcycle: 'Fietsen',
  Run: 'Lopen', TrailRun: 'Lopen', VirtualRun: 'Lopen',
  Walk: 'Wandelen', Hike: 'Wandelen',
  Swim: 'Zwemmen', OpenWaterSwim: 'Zwemmen',
  WeightTraining: 'Kracht', Workout: 'Kracht', Crossfit: 'Kracht',
  Elliptical: 'Crosstrainer', StairStepper: 'Crosstrainer',
  AlpineSki: 'Skiën', NordicSki: 'Skiën', BackcountrySki: 'Skiën',
};

async function request(path, params, cfg = icuConfig()) {
  if (!cfg.athleteId || !cfg.apiKey) throw new Error('Nog niet gekoppeld');
  const q = new URLSearchParams({ path: `athlete/${cfg.athleteId}/${path}`, ...params });
  const res = await fetch(`/api/intervals?${q}`, { headers: { Authorization: `Basic ${btoa(`API_KEY:${cfg.apiKey}`)}` } });
  if (res.status === 401 || res.status === 403) throw new Error('Sleutel of athlete-ID klopt niet');
  if (res.status === 404) throw new Error('Koppeling niet gevonden (werkt alleen op Vercel)');
  if (!res.ok) throw new Error(`Intervals.icu gaf fout ${res.status}`);
  return res.json();
}

/** Zet een activiteit van Intervals.icu om naar ons formaat. Onbekende velden worden genegeerd. */
export function mapActivity(a) {
  const start = a.start_date_local || a.start_date || '';
  const date = start.slice(0, 10);
  const secs = a.moving_time ?? a.elapsed_time ?? a.icu_recording_time ?? 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !secs) return null;
  const n = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const dist = n(a.distance ?? a.icu_distance);
  return {
    id: String(a.id),
    date,
    start,
    name: a.name || '',
    type: a.type || '',
    sport: SPORT[a.type] || 'Anders',
    movingMin: Math.round(secs / 60),
    distanceKm: dist != null ? Math.round(dist / 100) / 10 : null,
    avgHr: n(a.average_heartrate ?? a.icu_average_hr),
    maxHr: n(a.max_heartrate ?? a.icu_max_hr),
    rpe: n(a.icu_rpe ?? a.perceived_exertion),
    load: n(a.icu_training_load),
    source: 'intervals',
  };
}

/** Test de koppeling met één verzoek over de laatste 7 dagen. */
export async function icuTest(athleteId, apiKey) {
  const rows = await request('activities', { oldest: addDays(isoDate(), -7), newest: isoDate() }, { athleteId: athleteId.trim(), apiKey: apiKey.trim() });
  if (!Array.isArray(rows)) throw new Error('Onverwacht antwoord van Intervals.icu');
  return rows.length;
}

/**
 * Haalt activiteiten op sinds de vorige synchronisatie (3 dagen overlap, zodat aanpassingen
 * meekomen). De eerste keer: de laatste 2 jaar, in blokken van 6 maanden.
 */
export async function icuSync({ full = false } = {}) {
  const cfg = icuConfig();
  const today = isoDate();
  let from = !full && cfg.lastSync ? addDays(cfg.lastSync.slice(0, 10), -3) : addDays(today, -730);
  let total = 0;
  while (from <= today) {
    const to = addDays(from, 182) < today ? addDays(from, 182) : today;
    const rows = await request('activities', { oldest: from, newest: to });
    const mapped = (Array.isArray(rows) ? rows : []).map(mapActivity).filter(Boolean);
    if (mapped.length) await putActivities(mapped);
    total += mapped.length;
    from = addDays(to, 1);
  }
  set(K.last, new Date().toISOString());
  return total;
}

/** Synchroniseert stil als de laatste keer meer dan 3 uur geleden is. Geeft true als er iets veranderde. */
export async function icuAutoSync() {
  if (!icuConnected()) return false;
  const last = icuConfig().lastSync;
  if (last && Date.now() - new Date(last).getTime() < 3 * 3600 * 1000) return false;
  try { return (await icuSync()) > 0; } catch { return false; }
}

/** Activiteiten van één dag (voor het vooraf invullen van 'training gisteren'). */
export async function activitiesOn(date) {
  return (await getActivities()).filter((a) => a.date === date);
}
