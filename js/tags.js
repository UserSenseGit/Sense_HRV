// Tags-formulier (slaap, training, hoe je je voelt, leefstijl, eigen tags).

import { $, esc, notify, longDate, sleepHours, fmtHours } from './util.js';
import { getDay, putDay } from './db.js';

export const SPORTS = ['Fietsen', 'Lopen', 'Wandelen', 'Crosstrainer', 'Zwemmen', 'Kracht', 'Skiën', 'Anders'];
export const TRAINING = [['rest', 'Rust'], ['easy', 'Licht'], ['average', 'Gemiddeld'], ['intense', 'Intensief']];
export const ALCOHOL = [['nothing', 'Niets'], ['little', 'Een beetje'], ['toomuch', 'Te veel']];

// Schuifregelaars 0–10. 'worse' = hoger is slechter (kleurverloop omgekeerd).
const SLIDERS = {
  sleepQuality: { q: 'Hoe was je slaapkwaliteit?', lo: 'Slecht', hi: 'Goed' },
  performance: { q: 'Hoe presteerde je tijdens de training?', lo: 'Slecht', hi: 'Goed' },
  rpe: { q: 'RPE, ervaren inspanning van de training', lo: '0', hi: '10', worse: true },
  motivation: { q: 'Hoe gemotiveerd ben je om te trainen?', lo: 'Weinig', hi: 'Erg' },
  mentalEnergy: { q: 'Hoe is je mentale energie vanochtend?', lo: 'Minder', hi: 'Meer' },
  soreness: { q: 'Hoeveel spierpijn heb je vanochtend?', lo: 'Minder', hi: 'Meer', worse: true },
  fatigue: { q: 'Hoe vermoeid ben je vanochtend?', lo: 'Minder', hi: 'Meer', worse: true },
};

const DEFAULT_CUSTOM = ['Garmin HRV'];
export function customTagNames() {
  try { return JSON.parse(localStorage.getItem('sense.customTags') || 'null') || DEFAULT_CUSTOM; } catch { return DEFAULT_CUSTOM; }
}
export function setCustomTagNames(list) {
  try { localStorage.setItem('sense.customTags', JSON.stringify(list)); } catch { /* */ }
}

let current = null; // record dat bewerkt wordt

function slider(key, val) {
  const s = SLIDERS[key];
  const has = val != null && val !== '';
  return `<div class="field">
    <div class="field-head"><label class="q" for="tag-${key}">${s.q}</label>
      <span class="row" style="gap: 6px;"><button type="button" class="btn btn-sm btn-ghost clear-btn" data-clear="${key}" aria-label="Wissen" ${has ? '' : 'hidden'}>Wis</button>
      <span class="badge" id="badge-${key}">${has ? `${val}/10` : '–'}</span></span></div>
    <input type="range" class="range" id="tag-${key}" data-slider="${key}" min="0" max="10" step="1" value="${has ? Math.round(val) : 5}" ${has ? '' : 'data-empty="1" style="opacity:.5"'}>
    <div class="range-ends"><span>${s.lo}</span><span>${s.hi}</span></div>
  </div>`;
}

function segmented(key, options, val, label) {
  return `<div class="field">
    <span class="q">${label}</span>
    <div class="seg-ctl" role="group" aria-label="${label}">
      ${options.map(([v, l]) => `<button type="button" data-seg="${key}" data-val="${v}" aria-pressed="${val === v}">${l}</button>`).join('')}
    </div>
  </div>`;
}

let onDone = null; // waarheen na bewaren of sluiten

/** Opent het tags-formulier. `done` wordt na bewaren/sluiten aangeroepen (standaard: naar Vandaag). */
export async function openTags(date, done = null) {
  onDone = done;
  const rec = (await getDay(date)) || { date, tags: {} };
  rec.tags = rec.tags || {};
  current = rec;
  const t = rec.tags;
  const custom = customTagNames();
  for (const k of Object.keys(t.custom || {})) if (!custom.includes(k)) custom.push(k);
  const sheet = $('sheet');
  const hrs = t.sleepHours ?? sleepHours(t.bedTime, t.wakeTime);

  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head">
      <button class="btn btn-sm btn-ghost" id="tagsClose">Sluiten</button>
      <span class="sheet-title"><b>Tags</b><span class="small muted">${esc(longDate(date))}</span></span>
      <button class="btn btn-sm btn-ok" id="tagsSave">Bewaar</button>
    </div>

    <div class="section-label">Fysiologie</div>
    <div class="field">
      <div class="between"><span>Hartslag</span><span class="num">${rec.hr != null ? Math.round(rec.hr) : '–'}</span></div>
      <div class="between"><span>HRV (rMSSD)</span><span class="num accent-text">${rec.rmssd != null ? Number(rec.rmssd).toFixed(1).replace(/\.0$/, '') : '–'}</span></div>
      <div class="between"><label for="tag-extra">Extrasystolen</label>
        <div class="stepper"><button type="button" class="btn icon-btn" data-step="-1" aria-label="Eén minder">−</button>
        <input id="tag-extra" class="input" type="number" min="0" inputmode="numeric" value="${rec.extrasystolen ?? ''}">
        <button type="button" class="btn icon-btn" data-step="1" aria-label="Eén meer">+</button></div>
      </div>
    </div>

    <div class="section-label">Slaap</div>
    ${slider('sleepQuality', t.sleepQuality)}
    <div class="field">
      <div class="grid-2">
        <div><label class="lbl" for="tag-bed">Naar bed</label><input type="time" id="tag-bed" class="input" value="${esc(t.bedTime || '')}"></div>
        <div><label class="lbl" for="tag-wake">Opgestaan</label><input type="time" id="tag-wake" class="input" value="${esc(t.wakeTime || '')}"></div>
      </div>
      <div class="between"><span>Uren geslapen</span><span class="num" id="tag-hours">${fmtHours(hrs)}</span></div>
    </div>

    <div class="section-label">Training (gisteren)</div>
    ${segmented('training', TRAINING, t.training, 'Hoe was je training gisteren?')}
    <div id="trainingDetails" class="stack" ${!t.training || t.training === 'rest' ? 'hidden' : ''}>
      <div class="field">
        <label class="q" for="tag-sport">Welke sport?</label>
        <select id="tag-sport" class="input">
          ${SPORTS.map((s) => `<option ${t.sport === s ? 'selected' : ''}>${s}</option>`).join('')}
          ${t.sport && !SPORTS.includes(t.sport) ? `<option selected>${esc(t.sport)}</option>` : ''}
        </select>
      </div>
      ${slider('rpe', t.rpe)}
      <div class="field">
        <div class="grid-2">
          <div><label class="lbl" for="tag-dur">Duur (min)</label><input type="number" id="tag-dur" class="input" inputmode="numeric" min="0" value="${t.durationMin ?? ''}"></div>
          <div><label class="lbl" for="tag-dist">Afstand (km)</label><input type="number" id="tag-dist" class="input" inputmode="decimal" min="0" step="0.1" value="${t.distanceKm ?? ''}"></div>
        </div>
        <div><label class="lbl" for="tag-avghr">Gemiddelde hartslag (bpm, voor TRIMP)</label><input type="number" id="tag-avghr" class="input" inputmode="numeric" min="30" max="230" value="${t.avgHr ?? ''}"></div>
      </div>
      ${slider('performance', t.performance)}
    </div>

    <div class="section-label">Hoe voel je je</div>
    ${slider('motivation', t.motivation)}
    ${slider('mentalEnergy', t.mentalEnergy)}
    ${slider('soreness', t.soreness)}
    ${slider('fatigue', t.fatigue)}

    <div class="section-label">Leefstijl</div>
    ${segmented('alcohol', ALCOHOL, t.alcohol, 'Alcohol gisteravond?')}
    ${segmented('sick', [['no', 'Nee'], ['yes', 'Ja']], t.sick == null ? null : t.sick ? 'yes' : 'no', 'Ben je ziek?')}
    ${segmented('traveling', [['no', 'Nee'], ['yes', 'Ja']], t.traveling == null ? null : t.traveling ? 'yes' : 'no', 'Op reis?')}

    <div class="section-label">Eigen tags</div>
    <div class="field">
      <label class="q" for="tag-note">Notitie</label>
      <textarea id="tag-note" class="input">${esc(t.note || '')}</textarea>
    </div>
    ${custom.map((name, i) => `<div class="field"><div class="between"><label for="tag-c${i}">${esc(name)}</label>
      <input id="tag-c${i}" data-custom="${esc(name)}" class="input" style="width: 110px; text-align: center;" type="number" inputmode="decimal" step="0.1" value="${t.custom?.[name] ?? ''}"></div></div>`).join('')}

    <button class="btn btn-ok btn-block" id="tagsSave2">Bewaar</button>
  </div>`;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  document.body.style.overflow = 'hidden';

  sheet.oninput = (e) => {
    const el = e.target;
    if (el.dataset.slider) {
      el.removeAttribute('data-empty');
      el.dataset.touched = '1';
      el.style.opacity = '';
      $(`badge-${el.dataset.slider}`).textContent = `${el.value}/10`;
      sheet.querySelector(`button[data-clear="${el.dataset.slider}"]`).hidden = false;
    }
    if (el.id === 'tag-bed' || el.id === 'tag-wake') $('tag-hours').textContent = fmtHours(sleepHours($('tag-bed').value, $('tag-wake').value));
  };
  sheet.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.clear) {
      const el = $(`tag-${b.dataset.clear}`);
      el.dataset.empty = '1';
      el.dataset.touched = '1';
      el.value = 5;
      el.style.opacity = '.5';
      $(`badge-${b.dataset.clear}`).textContent = '–';
      b.hidden = true;
    } else if (b.dataset.seg) {
      const group = sheet.querySelectorAll(`button[data-seg="${b.dataset.seg}"]`);
      const wasOn = b.getAttribute('aria-pressed') === 'true';
      group.forEach((g) => g.setAttribute('aria-pressed', 'false'));
      if (!wasOn) b.setAttribute('aria-pressed', 'true');
      if (b.dataset.seg === 'training') $('trainingDetails').hidden = wasOn || b.dataset.val === 'rest';
    } else if (b.dataset.step) {
      const inp = $('tag-extra');
      inp.value = Math.max(0, (Number(inp.value) || 0) + Number(b.dataset.step));
    } else if (b.id === 'tagsSave' || b.id === 'tagsSave2') {
      saveTags();
    } else if (b.id === 'tagsClose') {
      const done = onDone;
      closeTags();
      if (done) done();
    }
  };
}

function segVal(key) {
  const b = $('sheet').querySelector(`button[data-seg="${key}"][aria-pressed="true"]`);
  return b ? b.dataset.val : null;
}
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

async function saveTags() {
  const rec = current;
  const sheet = $('sheet');
  const t = {};
  for (const key of Object.keys(SLIDERS)) {
    const el = $(`tag-${key}`);
    // Niet aangeraakt: exacte waarde behouden (ook decimalen uit een import). Gewist: leeg.
    if (!el || !el.dataset.touched) t[key] = rec.tags[key] ?? null;
    else t[key] = el.dataset.empty ? null : Number(el.value);
  }
  t.bedTime = $('tag-bed').value || null;
  t.wakeTime = $('tag-wake').value || null;
  t.sleepHours = sleepHours(t.bedTime, t.wakeTime) ?? rec.tags.sleepHours ?? null;
  t.training = segVal('training');
  if (t.training && t.training !== 'rest') {
    t.sport = $('tag-sport').value;
    t.durationMin = numOrNull($('tag-dur').value);
    t.distanceKm = numOrNull($('tag-dist').value);
    t.avgHr = numOrNull($('tag-avghr').value);
  } else {
    t.sport = null; t.durationMin = null; t.distanceKm = null; t.rpe = null; t.performance = null; t.avgHr = null;
  }
  t.alcohol = segVal('alcohol');
  const sick = segVal('sick'); t.sick = sick == null ? null : sick === 'yes';
  const trav = segVal('traveling'); t.traveling = trav == null ? null : trav === 'yes';
  t.note = $('tag-note').value.trim() || null;
  t.custom = {};
  sheet.querySelectorAll('input[data-custom]').forEach((el) => { if (el.value !== '') t.custom[el.dataset.custom] = Number(el.value); });
  // Velden uit een import die het formulier niet toont, blijven behouden.
  for (const k of ['physicalCondition', 'lifestyleStress', 'trainingMotivation']) if (rec.tags[k] != null) t[k] = rec.tags[k];

  rec.tags = t;
  rec.extrasystolen = numOrNull($('tag-extra').value);
  await putDay(rec);
  notify('Tags bewaard', longDate(rec.date));
  const done = onDone;
  closeTags();
  window.dispatchEvent(new CustomEvent('sense:data'));
  if (done) done();
  else window.dispatchEvent(new CustomEvent('sense:navigate', { detail: 'vandaag' }));
}

export function closeTags() {
  const sheet = $('sheet');
  sheet.hidden = true;
  sheet.innerHTML = '';
  document.body.style.overflow = '';
  current = null;
  onDone = null;
}
