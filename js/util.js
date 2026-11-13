// Kleine hulpfuncties die overal gebruikt worden.

export const $ = (id) => document.getElementById(id);

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function notify(msg, sub = '') {
  $('tMsg').textContent = msg;
  $('tSub').textContent = sub;
  const t = $('toast');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

/** Bevestigingsvenster. Geeft een Promise<boolean>. */
export function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const m = $('modal');
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    const ok = $('modalOk');
    ok.textContent = okLabel;
    ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    m.hidden = false;
    const done = (v) => { m.hidden = true; ok.onclick = null; $('modalCancel').onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    $('modalCancel').onclick = () => done(false);
  });
}

// ---- Datums (altijd lokale tijd, formaat YYYY-MM-DD) ----
const pad = (n) => String(n).padStart(2, '0');
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function hhmm(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(iso, n) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
export const dayShort = (iso) => DAYS[parseIso(iso).getDay()];
export const monthName = (iso) => MONTHS[parseIso(iso).getMonth()];
export function niceDate(iso) {
  const d = parseIso(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}
export function longDate(iso) {
  const d = parseIso(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Uren tussen bedtijd en opstaan (over middernacht heen). */
export function sleepHours(bed, wake) {
  if (!bed || !wake) return null;
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}
export function fmtHours(h) {
  if (h == null) return '–';
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
