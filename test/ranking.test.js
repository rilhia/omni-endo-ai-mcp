/**
 * Best/worst day and hour ranking: TIR first, then median absolute deviation
 * from the per-reading target (honouring hourly target profiles in the PDM),
 * then CV. The key case: two 100%-TIR days are no longer an arbitrary tie; the
 * one closer to target wins, and closeness-to-target is tried before CV.
 */

import { computeSummary, getThresholds, targetForEpoch, rankingMetrics } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

// Hourly target profile: 6.0 before noon, 7.0 from noon.
const settingsHistory = [{
  activeTimestamp: '2026-05-01T00:00:00.000Z',
  settings: {
    generalSettings: { activeInsulinTime: 3 },
    basalSettings: { maxBasalRate: 5 },
    profilesBolus: [{
      targetBgSegments: { data: [ { segmentStart: 0, value: 6.0 }, { segmentStart: 12, value: 7.0 } ] },
      isfSegments: { data: [ { segmentStart: 0, value: 1.7 } ] },
      insulinToCarbRatioSegments: { data: [ { segmentStart: 0, value: 7.5 } ] },
    }],
  },
}];
const th = getThresholds('mmol', 3.9, 10);
const mk = (iso, v) => ({ type: 'CGM', epoch: Math.floor(Date.parse(iso) / 1000), val: v });

// --- per-reading target lookup honours the hour segment --------------------
assert(targetForEpoch(mk('2026-06-01T08:00:00Z', 6).epoch, settingsHistory) === 6.0, 'morning reading resolves to 6.0 target');
assert(targetForEpoch(mk('2026-06-01T14:00:00Z', 7).epoch, settingsHistory) === 7.0, 'afternoon reading resolves to 7.0 target');

// --- two 100% TIR days, tie broken by closeness to target ------------------
const timeline = [
  mk('2026-06-01T08:00:00Z', 6.0), mk('2026-06-01T09:00:00Z', 6.1), mk('2026-06-01T14:00:00Z', 7.0), mk('2026-06-01T15:00:00Z', 6.9), // hugs target
  mk('2026-06-02T08:00:00Z', 9.5), mk('2026-06-02T09:00:00Z', 9.6), mk('2026-06-02T14:00:00Z', 9.5), mk('2026-06-02T15:00:00Z', 9.4), // in range, far from target, but FLATTER
];
const s = computeSummary(timeline, null, settingsHistory, th, 'mmol/L', 'wider', null);

assert(s.bestWorst.bestDay.tir === 100 && s.bestWorst.worstDay.tir === 100, 'both candidate days are 100% TIR (a genuine tie on TIR)');
assert(s.bestWorst.bestDay.day === '2026-06-01', 'best day is the one hugging target, not arbitrary first');
assert(s.bestWorst.worstDay.day === '2026-06-02', 'worst day is the in-range-but-far-from-target one');
assert(s.bestWorst.bestDay.medianAbsTargetDev < s.bestWorst.worstDay.medianAbsTargetDev, 'best day has smaller median target deviation');
assert(
  s.bestWorst.worstDay.cv < s.bestWorst.bestDay.cv,
  'worst day is actually FLATTER (lower CV), proving target-closeness is ranked before CV'
);

// --- ranking metrics expose the reasoning ----------------------------------
assert('medianAbsTargetDev' in s.bestWorst.bestDay && 'cv' in s.bestWorst.bestDay, 'best/worst entries carry the tie-break metrics');

// --- graceful fallback when no settings/targets available ------------------
const noSettings = computeSummary(timeline, null, [], th, 'mmol/L', 'wider', null);
assert(noSettings.bestWorst.bestDay.medianAbsTargetDev === null, 'no settings -> medianAbsTargetDev null (falls back to CV, no throw)');

// --- best/worst hour also ranked the same way ------------------------------
assert(s.bestWorst.bestHour.tir !== undefined && 'medianAbsTargetDev' in s.bestWorst.bestHour, 'best hour carries the same ranking metrics');

console.log('\nBest/worst ranking test complete.');
