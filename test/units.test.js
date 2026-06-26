/**
 * Unit conversion. All glucose is stored internally in mmol/L. Every value a
 * tool emits must be converted to the user's chosen display unit: absolute
 * values (averages, readings, extremes, targets) scale-and-are-rounded for
 * mg/dL; spreads/deltas (stdDev, ISF, median target deviation, velocity) scale
 * by the factor only. Unit-INDEPENDENT metrics (TIR %, CV %, GMI) must be
 * identical in both units. This guards the mg/dL path, which had no coverage
 * when it was silently emitting mmol numbers.
 */

import {
  computeSummary,
  getThresholds,
  toDisplay,
  toDisplayDelta,
  buildEnrichedBolusLog,
} from '../src/analytics.js';

const F = 18.0182;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}
const approx = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// --- the converters themselves ---------------------------------------------
assert(toDisplay(6.0, 'mmol') === 6.0, 'toDisplay mmol keeps value');
assert(toDisplay(6.0, 'mgdl') === Math.round(6.0 * F), 'toDisplay mgdl scales and rounds (108)');
assert(toDisplay(null, 'mgdl') === null, 'toDisplay null-safe');
assert(toDisplayDelta(2.0, 'mmol') === 2.0, 'toDisplayDelta mmol keeps value');
assert(toDisplayDelta(2.0, 'mgdl') === Math.round(2.0 * F), 'toDisplayDelta mgdl scales by factor only (36)');

const mk = (iso, v) => ({ type: 'CGM', epoch: Math.floor(Date.parse(iso) / 1000), val: v, vel: 0, time: new Date(Date.parse(iso)).toISOString() });
const tl = [
  mk('2026-06-01T08:00:00Z', 6.0),
  mk('2026-06-01T09:00:00Z', 7.0),
  mk('2026-06-01T10:00:00Z', 8.0),
  mk('2026-06-01T11:00:00Z', 12.0),
  mk('2026-06-01T12:00:00Z', 3.5),
];

const mmol = computeSummary(tl, null, [], getThresholds('mmol', 3.9, 10), 'mmol/L', 'wider', null);
const mgdl = computeSummary(tl, null, [], getThresholds('mgdl', 70, 180), 'mg/dL', 'wider', null);

// --- absolute values convert -----------------------------------------------
assert(approx(mgdl.glucoseControl.averageBG, mmol.glucoseControl.averageBG * F), 'averageBG converts to mg/dL');
assert(mgdl.glucoseExtremes.highest.value === Math.round(12.0 * F), 'highest extreme converts (216)');
assert(mgdl.glucoseExtremes.lowest.value === Math.round(3.5 * F), 'lowest extreme converts (63)');
assert(Number.isInteger(mgdl.glucoseControl.averageBG), 'mg/dL average is a whole number');
assert(Number.isInteger(mgdl.glucoseExtremes.highest.value), 'mg/dL extreme is a whole number');

// --- deltas convert by factor only -----------------------------------------
assert(approx(mgdl.glucoseControl.stdDev, mmol.glucoseControl.stdDev * F, 2), 'stdDev converts as a delta');

// --- unit-independent metrics are identical --------------------------------
assert(mmol.glucoseControl.timeInRange === mgdl.glucoseControl.timeInRange, 'TIR identical in both units');
assert(mmol.glucoseControl.coefficientOfVariation === mgdl.glucoseControl.coefficientOfVariation, 'CV identical in both units');
assert(mmol.glucoseControl.gmiEstimatedA1c === mgdl.glucoseControl.gmiEstimatedA1c, 'GMI identical in both units');

// --- settings target/ISF profiles convert ----------------------------------
const settingsHistory = [{
  activeTimestamp: '2026-05-01T00:00:00.000Z',
  settings: {
    generalSettings: { activeInsulinTime: 3 },
    basalSettings: { maxBasalRate: 5 },
    profilesBolus: [{
      targetBgSegments: { data: [{ segmentStart: 0, value: 6.0 }] },
      isfSegments: { data: [{ segmentStart: 0, value: 2.0 }] },
      insulinToCarbRatioSegments: { data: [{ segmentStart: 0, value: 8.0 }] },
    }],
  },
}];
const mgdlS = computeSummary(tl, null, settingsHistory, getThresholds('mgdl', 70, 180), 'mg/dL', 'wider', null);
assert(mgdlS.settings[0].targetBg[0].value === Math.round(6.0 * F), 'settings target converts to mg/dL (108)');
assert(mgdlS.settings[0].isf[0].value === Math.round(2.0 * F), 'settings ISF converts as a delta (36)');
assert(mgdlS.settings[0].carbRatio[0].value === 8.0, 'carb ratio is unit-independent (unchanged)');

console.log('\nUnit conversion test complete.');
