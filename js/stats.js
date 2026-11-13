// Berekeningen op RR-intervallen. De formules voor HR en gepoolde rMSSD
// zijn ongewijzigd overgenomen uit de oorspronkelijke Sense HRV.

/** HR en rMSSD van één reeks RR-intervallen (ms). */
export function calcSliceStats(rrList) {
  const avg = rrList.reduce((a, b) => a + b, 0) / rrList.length;
  let sumSq = 0;
  for (let i = 0; i < rrList.length - 1; i++) sumSq += Math.pow(rrList[i + 1] - rrList[i], 2);
  return { hr: 60000 / avg, rmssd: Math.sqrt(sumSq / (rrList.length - 1)) };
}

/**
 * Resultaat over alle actieve (niet-overgeslagen) segmenten.
 * - HR: gemiddelde over alle slagen in actieve segmenten
 * - rMSSD: gepoold, (N_i - 1)-gewogen gemiddelde van rMSSD_i²
 * - AVNN, SDNN: over de RR-waarden van alle actieve segmenten
 * - pNN50: aandeel opeenvolgende verschillen > 50 ms (binnen segmenten)
 * - extrasystolen: aantal onderbrekingen tussen opeenvolgende actieve segmenten
 */
export function analyse(data, segments) {
  const active = segments.filter((s) => !s.bypassed).slice().sort((a, b) => a.s - b.s);
  let sumWeightedVariance = 0, totalDiffCount = 0, rrSum = 0, beatCount = 0, duration = 0;
  let nn50 = 0;
  const allRR = [];
  const used = [];

  for (const seg of active) {
    const rr = data.slice(seg.s, seg.e + 1).map((d) => d.rr);
    if (rr.length < 2) continue;
    used.push(seg);
    beatCount += rr.length;
    rrSum += rr.reduce((a, b) => a + b, 0);
    duration += data[seg.e].t - data[seg.s].t;
    const st = calcSliceStats(rr);
    sumWeightedVariance += (rr.length - 1) * Math.pow(st.rmssd, 2);
    totalDiffCount += rr.length - 1;
    for (let i = 0; i < rr.length - 1; i++) if (Math.abs(rr[i + 1] - rr[i]) > 50) nn50++;
    allRR.push(...rr);
  }
  if (totalDiffCount === 0) return null;

  const avnn = rrSum / beatCount;
  const sdnn = Math.sqrt(allRR.reduce((a, v) => a + Math.pow(v - avnn, 2), 0) / (allRR.length - 1 || 1));

  // Onderbrekingen: een gat van minstens 1 slag tussen twee opeenvolgende actieve segmenten.
  let gaps = 0;
  for (let i = 1; i < used.length; i++) if (used[i].s > used[i - 1].e + 1) gaps++;

  return {
    hr: 60000 / avnn,
    rmssd: Math.sqrt(sumWeightedVariance / totalDiffCount),
    avnn,
    sdnn,
    pnn50: (nn50 / totalDiffCount) * 100,
    duration,
    segments: used.length,
    extrasystolen: gaps,
  };
}

export const round1 = (v) => (v == null || isNaN(v) ? null : Math.round(v * 10) / 10);
