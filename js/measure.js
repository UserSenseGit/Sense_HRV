// Meten: Bluetooth-sensor, opname, tachogram, segmenten en filteren.
// De meet- en filterlogica is overgenomen uit de oorspronkelijke Sense HRV.

import { $, notify, confirmDialog, isoDate, hhmm } from './util.js';
import { analyse, calcSliceStats, round1 } from './stats.js';
import { getDay, putDay, requestPersist } from './db.js';
import { openTags } from './tags.js';

const COLORS = ['#7aa7c7', '#9cc33a', '#fdba74', '#b49be6', '#f0a6ca', '#5fc4cf', '#f59e5b', '#c3d36a', '#f87171', '#8b93d8'];
const MUTED = '#a8a29e';
const LINE = '#2a2e38';

let device, hrChar, recording = false, startTime = 0, timerInterval;
let data = [], segments = [], selStart = null, swallowMarks = [], chart;
let lastRR = [];
let editingDate = null; // datum van een heropende meting (heranalyse)

const ui = {};

export function initMeasure() {
  for (const id of ['connectBtn', 'recordBtn', 'statusText', 'statusDot', 'liveHR', 'qualityText', 'resultCard', 'resHR', 'resRMSSD',
    'resExtra', 'activeCount', 'duration', 'timerDisplay', 'countdown', 'stopEarlyBtn', 'swallowBtn', 'segmentList', 'segmentSection',
    'resetSegments', 'autoSegmentBtn', 'resetZoom', 'limitMin', 'limitMax', 'segmentToggle', 'saveSection', 'saveDate', 'saveExtra', 'saveBtn']) {
    ui[id] = $(id);
  }
  try {
    const lim = JSON.parse(localStorage.getItem('sense.limits') || 'null');
    if (lim) { ui.limitMin.value = lim.min; ui.limitMax.value = lim.max; }
    const dur = localStorage.getItem('sense.duration');
    if (dur) ui.duration.value = dur;
  } catch { /* geen opslag */ }

  initChart();
  ui.connectBtn.onclick = connect;
  ui.recordBtn.onclick = async () => {
    if (data.length > 0) {
      const ok = await confirmDialog('Nieuwe opname starten?', 'De huidige, niet-opgeslagen data gaat verloren.', 'Starten');
      if (!ok) return;
    }
    startRecording();
  };
  ui.stopEarlyBtn.onclick = stopRecording;
  ui.swallowBtn.onclick = () => {
    if (!recording) return;
    swallowMarks.push((Date.now() - startTime) / 1000);
    notify('Slikken gemarkeerd', 'Moment vastgelegd');
  };
  ui.autoSegmentBtn.onclick = autoSegment;
  ui.resetSegments.onclick = () => { segments = []; swallowMarks = []; updateUI(); };
  ui.resetZoom.onclick = () => chart.resetZoom();
  ui.saveBtn.onclick = save;
  ui.duration.onchange = () => { try { localStorage.setItem('sense.duration', ui.duration.value); } catch { /* */ } };
  const saveLimits = () => { try { localStorage.setItem('sense.limits', JSON.stringify({ min: ui.limitMin.value, max: ui.limitMax.value })); } catch { /* */ } };
  ui.limitMin.onchange = saveLimits;
  ui.limitMax.onchange = saveLimits;

  // Knoppen in de segmentkaarten (event delegation)
  ui.segmentList.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = Number(b.dataset.i);
    const seg = segments[i];
    if (!seg) return;
    switch (b.dataset.act) {
      case 'bypass': seg.bypassed = !seg.bypassed; break;
      case 'remove': segments.splice(i, 1); break;
      case 'start-': if (seg.s - 1 >= 0) seg.s--; break;
      case 'start+': if (seg.s + 1 < seg.e) seg.s++; break;
      case 'end-': if (seg.e - 1 > seg.s) seg.e--; break;
      case 'end+': if (seg.e + 1 < data.length) seg.e++; break;
    }
    updateUI();
  });
}

function initChart() {
  const ctx = $('mainChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { datasets: [{
      data: [], borderColor: '#5b616e', backgroundColor: 'rgba(63, 111, 143, 0.08)',
      borderWidth: 1.5, pointRadius: 4, pointHoverRadius: 10, hitRadius: 35, pointHitRadius: 35, tension: 0.1, fill: true,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { type: 'linear', grid: { display: false }, ticks: { color: MUTED, font: { size: 10 } } },
        y: { suggestedMin: 40, suggestedMax: 100, grid: { color: LINE }, ticks: { color: MUTED, font: { size: 10 } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        zoom: { pan: { enabled: true, mode: 'x' }, zoom: { pinch: { enabled: true }, mode: 'x' } },
      },
      onClick: (e) => {
        const pts = chart.getElementsAtEventForMode(e, 'nearest', { intersect: false }, true);
        if (pts.length > 0) handlePointClick(pts[0].index);
      },
    },
  });
}

async function connect() {
  if (!navigator.bluetooth) {
    notify('Bluetooth niet beschikbaar', 'Gebruik Chrome op Android');
    return;
  }
  try {
    notify('Zoeken…', 'Koppel je sensor');
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    hrChar = await service.getCharacteristic('heart_rate_measurement');
    await hrChar.startNotifications();
    hrChar.addEventListener('characteristicvaluechanged', (e) => {
      const v = e.target.value;
      const flags = v.getUint8(0);
      let off = 1;
      const hr = (flags & 1) ? v.getUint16(off, true) : v.getUint8(off);
      off += (flags & 1) ? 2 : 1;
      if (flags & 8) off += 2; // energy expended aanwezig: overslaan
      ui.liveHR.textContent = hr;
      if (flags & 16) {
        for (; off + 1 < v.byteLength; off += 2) {
          const rr = Math.round((v.getUint16(off, true) / 1024) * 1000);
          updateQuality(rr);
          if (recording) {
            data.push({ t: (Date.now() - startTime) / 1000, rr, bpm: 60000 / rr });
            updateChart();
          }
        }
      }
    });
    device.addEventListener('gattserverdisconnected', () => {
      ui.statusText.textContent = 'Verbinding verbroken';
      ui.statusDot.classList.remove('on');
      ui.recordBtn.disabled = true;
    });
    ui.statusText.textContent = device.name || 'Sensor';
    ui.statusDot.classList.add('on');
    ui.recordBtn.disabled = false;
    notify('Verbonden', device.name || '');
  } catch (err) {
    notify('Fout', err.message);
  }
}

function updateQuality(rr) {
  lastRR.push(rr);
  if (lastRR.length > 10) lastRR.shift();
  if (lastRR.length < 5) return;
  const avg = lastRR.reduce((a, b) => a + b, 0) / lastRR.length;
  const avgDiff = lastRR.map((v) => Math.abs(v - avg)).reduce((a, b) => a + b, 0) / lastRR.length;
  const variation = (avgDiff / avg) * 100;
  let label = 'Goed', cls = 'good';
  if (variation > 30) { label = 'Slecht'; cls = 'poor'; } else if (variation > 15) { label = 'Matig'; cls = 'fair'; }
  ui.qualityText.textContent = label;
  ui.qualityText.className = `quality ${cls}`;
}

function startRecording() {
  data = []; segments = []; swallowMarks = []; selStart = null; editingDate = null;
  startTime = Date.now(); recording = true;
  ui.timerDisplay.hidden = false;
  ui.resultCard.hidden = true;
  ui.segmentSection.hidden = true;
  ui.saveSection.hidden = true;
  chart.data.datasets[0].data = [];
  chart.resetZoom(); chart.update();
  const total = parseInt(ui.duration.value, 10);
  const tick = () => {
    const remaining = total - Math.floor((Date.now() - startTime) / 1000);
    if (remaining <= 0) { stopRecording(); return; }
    ui.countdown.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

function stopRecording() {
  clearInterval(timerInterval);
  recording = false;
  ui.timerDisplay.hidden = true;
  if (data.length) { ui.segmentSection.hidden = false; showSave(); }
  notify('Klaar', 'Bekijk en filter de data');
  updateChart();
}

function autoSegment() {
  if (!data.length) return;
  segments = [];
  const min = parseInt(ui.limitMin.value, 10) || 0;
  const max = parseInt(ui.limitMax.value, 10) || 250;
  let cur = null;
  for (let i = 0; i < data.length; i++) {
    const inRange = data[i].bpm >= min && data[i].bpm <= max;
    if (inRange && cur === null) cur = i;
    else if (!inRange && cur !== null) {
      if (i - 1 > cur) segments.push({ s: cur, e: i - 1, bypassed: false, color: COLORS[segments.length % COLORS.length] });
      cur = null;
    }
  }
  if (cur !== null && data.length - 1 > cur) segments.push({ s: cur, e: data.length - 1, bypassed: false, color: COLORS[segments.length % COLORS.length] });
  updateUI();
}

function handlePointClick(idx) {
  if (recording) return;
  if (!ui.segmentToggle.checked) {
    const p = data[idx];
    notify('Slag', `${p.bpm.toFixed(1)} bpm op ${p.t.toFixed(1)} s`);
    return;
  }
  if (selStart === null) {
    selStart = idx;
    notify('Begin gekozen', 'Kies een eindpunt');
  } else {
    const s = Math.min(selStart, idx), e = Math.max(selStart, idx);
    if (s !== e) {
      segments.push({ s, e, bypassed: false, color: COLORS[segments.length % COLORS.length] });
      updateUI();
    }
    selStart = null;
  }
}

function updateChart() {
  const ds = chart.data.datasets[0];
  const near = (d) => swallowMarks.some((t) => Math.abs(d.t - t) < 0.8);
  ds.data = data.map((d) => ({ x: d.t, y: d.bpm }));
  ds.pointBackgroundColor = data.map((d, i) => {
    const seg = segments.find((s) => i >= s.s && i <= s.e);
    if (!seg) return '#5b616e';
    return seg.bypassed ? '#3a3f4a' : seg.color;
  });
  ds.pointRadius = data.map((d, i) => (near(d) ? 8 : segments.some((s) => i >= s.s && i <= s.e) ? 5 : 2));
  ds.pointBorderColor = data.map((d) => (near(d) ? '#b49be6' : 'transparent'));
  ds.pointBorderWidth = data.map((d) => (near(d) ? 4 : 0));
  chart.update('none');
}

function updateUI() {
  const list = ui.segmentList;
  list.innerHTML = '';
  segments.forEach((seg, i) => {
    const slice = data.slice(seg.s, seg.e + 1).map((d) => d.rr);
    if (slice.length < 2) return;
    const st = calcSliceStats(slice);
    const dur = data[seg.e].t - data[seg.s].t;
    const el = document.createElement('div');
    el.className = `seg${seg.bypassed ? ' bypassed' : ''}`;
    el.style.borderLeftColor = seg.color;
    el.innerHTML = `
      <div class="seg-head">
        <div>
          <div class="row" style="gap: 8px;"><b>Segment ${i + 1}</b><span class="pill pill-muted">${dur.toFixed(1)} s</span></div>
          <div class="seg-stats">
            <div><div class="small muted">HR</div><span class="num">${Math.round(st.hr)}</span></div>
            <div><div class="small muted">rMSSD</div><span class="num" style="color: ${seg.color}">${st.rmssd.toFixed(1)}</span></div>
          </div>
        </div>
        <div class="row" style="gap: 6px;">
          <button class="btn btn-sm" data-act="bypass" data-i="${i}">${seg.bypassed ? 'Herstel' : 'Overslaan'}</button>
          <button class="btn icon-btn btn-danger" data-act="remove" data-i="${i}" aria-label="Segment ${i + 1} verwijderen">&times;</button>
        </div>
      </div>
      <div class="trim">
        <div><div class="small muted" style="text-align: center;">Begin</div>
          <div class="trim-ctl"><button class="btn" data-act="start-" data-i="${i}" aria-label="Begin vroeger">−</button><span>${data[seg.s].t.toFixed(0)} s</span><button class="btn" data-act="start+" data-i="${i}" aria-label="Begin later">+</button></div></div>
        <div><div class="small muted" style="text-align: center;">Einde</div>
          <div class="trim-ctl"><button class="btn" data-act="end-" data-i="${i}" aria-label="Einde vroeger">−</button><span>${data[seg.e].t.toFixed(0)} s</span><button class="btn" data-act="end+" data-i="${i}" aria-label="Einde later">+</button></div></div>
      </div>`;
    list.appendChild(el);
  });
  updateChart();
  calculateGlobal();
}

let lastResult = null;
function calculateGlobal() {
  const r = analyse(data, segments);
  lastResult = r;
  if (!r) {
    ui.resultCard.hidden = true;
    ui.activeCount.textContent = '0 segmenten (0 s)';
    ui.saveExtra.value = '';
    return;
  }
  ui.resHR.textContent = Math.round(r.hr);
  ui.resRMSSD.textContent = r.rmssd.toFixed(1);
  ui.resExtra.textContent = r.extrasystolen;
  ui.saveExtra.value = r.extrasystolen;
  // Groen bij minstens 1 minuut actieve data (zoals voorheen)
  const ready = r.duration >= 60;
  ui.resHR.classList.toggle('ready', ready);
  ui.resRMSSD.classList.toggle('ready', ready);
  ui.activeCount.textContent = `${r.segments} segmenten (${r.duration.toFixed(1)} s)`;
  ui.resultCard.hidden = false;
}

function showSave() {
  ui.saveSection.hidden = false;
  if (!ui.saveDate.value || !editingDate) ui.saveDate.value = editingDate || isoDate();
}

async function save() {
  const r = lastResult;
  if (!r) { notify('Nog geen resultaat', 'Maak eerst segmenten (auto-filter)'); return; }
  const date = ui.saveDate.value || isoDate();
  const existing = await getDay(date);
  if (existing?.rmssd != null && date !== editingDate) {
    const ok = await confirmDialog('Dag bestaat al', `Er is al een meting op ${date}. Overschrijven? Je tags blijven behouden.`, 'Overschrijven', true);
    if (!ok) return;
  }
  const extra = ui.saveExtra.value === '' ? r.extrasystolen : Number(ui.saveExtra.value);
  const rec = existing || { date, tags: {} };
  Object.assign(rec, {
    date,
    time: date === editingDate && existing?.time ? existing.time : hhmm(new Date(startTime || Date.now())),
    source: 'sense',
    hr: round1(r.hr),
    rmssd: round1(r.rmssd),
    avnn: round1(r.avnn),
    sdnn: round1(r.sdnn),
    pnn50: round1(r.pnn50),
    extrasystolen: extra,
    measurement: {
      data: data.map((d) => ({ t: Math.round(d.t * 1000) / 1000, rr: d.rr })),
      segments: segments.map(({ s, e, bypassed }) => ({ s, e, bypassed })),
      swallowMarks,
      limits: { min: Number(ui.limitMin.value), max: Number(ui.limitMax.value) },
      duration: r.duration,
      device: device?.name || existing?.measurement?.device || null,
    },
  });
  await putDay(rec);
  requestPersist();
  editingDate = date;
  notify('Opgeslagen', `${date} · rMSSD ${rec.rmssd}`);
  openTags(date);
}

/** Open een opgeslagen meting opnieuw om te herfilteren. */
export function loadMeasurement(rec) {
  if (!rec?.measurement?.data?.length) return false;
  recording = false;
  clearInterval(timerInterval);
  ui.timerDisplay.hidden = true;
  data = rec.measurement.data.map((d) => ({ t: d.t, rr: d.rr, bpm: 60000 / d.rr }));
  segments = rec.measurement.segments.map((s, i) => ({ ...s, color: COLORS[i % COLORS.length] }));
  swallowMarks = rec.measurement.swallowMarks || [];
  if (rec.measurement.limits) { ui.limitMin.value = rec.measurement.limits.min; ui.limitMax.value = rec.measurement.limits.max; }
  selStart = null;
  editingDate = rec.date;
  startTime = 0;
  ui.saveDate.value = rec.date;
  ui.segmentSection.hidden = false;
  chart.resetZoom();
  updateUI();
  showSave();
  if (rec.extrasystolen != null) ui.saveExtra.value = rec.extrasystolen;
  return true;
}

// Alleen voor tests: simuleer een opname zonder sensor.
window.__senseDemo = (rrList) => {
  data = []; segments = []; swallowMarks = []; editingDate = null;
  let t = 0;
  for (const rr of rrList) { t += rr / 1000; data.push({ t, rr, bpm: 60000 / rr }); }
  startTime = Date.now();
  ui.segmentSection.hidden = false;
  updateChart();
  showSave();
};
