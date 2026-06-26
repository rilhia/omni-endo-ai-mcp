/**
 * Tests the glucoseExtremes section of computeSummary: the highest and lowest
 * glucose readings in the window, each with its timestamp, and EVERY instance
 * returned when a peak or trough value repeats (e.g. four readings of 17.9 all
 * come back, not just one).
 */

import { computeSummary, getThresholds } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

const mk = (iso, v) => ({ type: 'CGM', epoch: Math.floor(Date.parse(iso) / 1000), val: v });
const th = getThresholds('mmol', 3.9, 10);

// --- 1. Duplicate highs and lows: all instances returned --------------------
const timeline = [
  mk('2026-06-01T00:00:00Z', 7.0),
  mk('2026-06-01T00:05:00Z', 2.9),  // low 1
  mk('2026-06-01T01:00:00Z', 12.4),
  mk('2026-06-01T02:00:00Z', 17.9), // high 1
  mk('2026-06-01T03:00:00Z', 2.9),  // low 2
  mk('2026-06-01T04:00:00Z', 17.9), // high 2
  mk('2026-06-01T06:00:00Z', 17.9), // high 3
  mk('2026-06-01T07:00:00Z', 2.9),  // low 3
];
const s = computeSummary(timeline, null, [], th, 'mmol/L', 'wider', null);
const ex = s.glucoseExtremes;

assert(ex.highest.value === 17.9, 'highest value is 17.9');
assert(ex.highest.count === 3, `all 3 instances of the high returned (got ${ex.highest.count})`);
assert(ex.lowest.value === 2.9, 'lowest value is 2.9');
assert(ex.lowest.count === 3, `all 3 instances of the low returned (got ${ex.lowest.count})`);
assert(ex.highest.instances.every((i) => i.value === 17.9 && i.time), 'each high instance has value and time');
assert(ex.lowest.instances.every((i) => i.value === 2.9 && i.time), 'each low instance has value and time');
// Instances chronologically ordered
const t = ex.highest.instances.map((i) => i.time);
assert(t[0] < t[1] && t[1] < t[2], 'high instances are chronologically ordered');
assert(ex.highest.instances[0].time === '2026-06-01T02:00:00.000Z', 'first high instance timestamp correct');

// --- 2. Single-instance extreme --------------------------------------------
const single = computeSummary([
  mk('2026-06-02T08:00:00Z', 5.0),
  mk('2026-06-02T09:00:00Z', 11.2), // sole high
  mk('2026-06-02T10:00:00Z', 4.1),  // sole low
], null, [], th, 'mmol/L', 'wider', null);
assert(single.glucoseExtremes.highest.count === 1, 'single high instance returns count 1');
assert(single.glucoseExtremes.lowest.count === 1, 'single low instance returns count 1');
assert(single.glucoseExtremes.highest.instances[0].time === '2026-06-02T09:00:00.000Z', 'single high timestamp correct');

// --- 3. Empty timeline: extremes null, no throw ----------------------------
const empty = computeSummary([], null, [], th, 'mmol/L', 'wider', null);
assert(empty.glucoseExtremes === null, 'empty window yields null extremes, no throw');

// --- 4. Real June 17 values: high 10.1 twice, low 3.1 once ------------------
const real = computeSummary([
  mk('2026-06-17T12:46:42Z', 10.1),
  mk('2026-06-17T13:46:43Z', 10.1),
  mk('2026-06-17T20:26:54Z', 3.1),
  mk('2026-06-17T00:04:26Z', 8.8),
], null, [], th, 'mmol/L', 'wider', null);
assert(real.glucoseExtremes.highest.count === 2, 'real June 17: both 10.1 highs returned');
assert(real.glucoseExtremes.lowest.count === 1, 'real June 17: single 3.1 low returned');

console.log('\nGlucose extremes test complete.');
