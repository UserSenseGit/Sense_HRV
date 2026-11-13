// Opstart en navigatie. De tabs zijn bewust vast gecodeerd.

import { $, longDate, isoDate } from './util.js';
import { initMeasure } from './measure.js';
import { renderToday, renderHistory, renderMore } from './views.js';
import { closeTags } from './tags.js';
import { renderTrends } from './trends.js';

const VIEWS = ['vandaag', 'meten', 'historiek', 'trends', 'meer'];
const RENDER = { vandaag: renderToday, historiek: renderHistory, trends: renderTrends, meer: renderMore };
let currentView = 'vandaag';

function navigate(view) {
  if (!VIEWS.includes(view)) view = 'vandaag';
  currentView = view;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.tab === view) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  RENDER[view]?.();
  window.scrollTo(0, 0);
  try { sessionStorage.setItem('sense.view', view); } catch { /* */ }
}

function init() {
  $('headerDate').textContent = longDate(isoDate());
  initMeasure();
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => { closeTags(); navigate(t.dataset.tab); }; });
  window.addEventListener('sense:navigate', (e) => navigate(e.detail));
  window.addEventListener('sense:data', () => RENDER[currentView]?.());
  let start = 'vandaag';
  try { start = sessionStorage.getItem('sense.view') || 'vandaag'; } catch { /* */ }
  navigate(start);
}

init();
