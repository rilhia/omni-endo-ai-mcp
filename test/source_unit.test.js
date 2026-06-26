/**
 * Glooko source-unit normalisation. Glooko delivers glucose in the unit the
 * user configured in their Glooko account (mg/dL for many US accounts, mmol/L
 * elsewhere), set via GLOOKO_GLUCOSE_UNIT. ALL incoming glucose must be
 * normalised to the canonical internal unit (mmol/L) at ingest, so the archive
 * is consistent no matter how the source account is configured, and the
 * display layer (OMNI_UNITS) converts back out correctly. This is SEPARATE
 * from OMNI_UNITS: source unit = how data arrives; display unit = how it's shown.
 */

import { processUnifiedGlookoData, getActiveSettings } from '../src/analytics.js';

const F = 18.0182;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}
const approx = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

// The same physiological data, expressed in each source unit.
const mmolRaw = { series: {
  cgmNormal: [{ x: 1778976000, y: 6.0 }, { x: 1778976300, y: 9.0 }],
  deliveredBolus: [{ x: 1778976600, y: 2, insulinDelivered: 2, insulinProgrammed: 2, bloodGlucoseInput: 9.0, bloodGlucoseInputSource: 'CGM', carbsInput: 0, isManual: false, insulinRecommendationForCorrection: 1 }],
}};
const mgdlRaw = { series: {
  cgmNormal: [{ x: 1778976000, y: 108.0 }, { x: 1778976300, y: 162.0 }],
  deliveredBolus: [{ x: 1778976600, y: 2, insulinDelivered: 2, insulinProgrammed: 2, bloodGlucoseInput: 162.0, bloodGlucoseInputSource: 'CGM', carbsInput: 0, isManual: false, insulinRecommendationForCorrection: 1 }],
}};

// --- CGM + bolus normalisation ---------------------------------------------
process.env.GLOOKO_GLUCOSE_UNIT = 'mmol';
const a = processUnifiedGlookoData(mmolRaw);
process.env.GLOOKO_GLUCOSE_UNIT = 'mgdl';
const b = processUnifiedGlookoData(mgdlRaw);

const cgmA = a.filter((x) => x.type === 'CGM').map((x) => x.val);
const cgmB = b.filter((x) => x.type === 'CGM').map((x) => x.val);
assert(approx(cgmA[0], 6) && approx(cgmA[1], 9), 'mmol-source CGM stored as-is (canonical mmol)');
assert(approx(cgmB[0], 6) && approx(cgmB[1], 9), 'mgdl-source CGM (108/162) normalised to mmol (6/9)');

const bolA = a.find((x) => x.type === 'BOLUS');
const bolB = b.find((x) => x.type === 'BOLUS');
assert(approx(bolA.bgInput, 9), 'mmol-source bgInput stored as-is');
assert(approx(bolB.bgInput, 9), 'mgdl-source bgInput (162) normalised to mmol (9)');

// velocity is a delta of normalised readings: 9-6=3 mmol either way
const velB = b.filter((x) => x.type === 'CGM')[1].vel;
assert(approx(velB, 3, 0.05), 'velocity derived from normalised readings (3 mmol)');

// --- settings (target absolute, ISF delta) normalisation -------------------
const settingsJson = { deviceSettings: { pumps: { g1: { '2026-05-01T00:00:00Z': {
  generalSettings: { activeInsulinTime: 3 },
  basalSettings: { maxBasalRate: 5 },
  profilesBolus: [{
    targetBgSegments: { data: [{ segmentStart: 0, value: 108.0 }] },
    isfSegments: { data: [{ segmentStart: 0, value: 36.0 }] },
    insulinToCarbRatioSegments: { data: [{ segmentStart: 0, value: 8 }] },
  }],
} } } } };

process.env.GLOOKO_GLUCOSE_UNIT = 'mgdl';
const s = getActiveSettings(settingsJson, '2026-05-01', '2026-06-01');
const prof = s[0].settings.profilesBolus[0];
assert(approx(prof.targetBgSegments.data[0].value, 6), 'mgdl-source target (108) normalised to mmol (6)');
assert(approx(prof.isfSegments.data[0].value, 2), 'mgdl-source ISF (36) normalised as a delta to mmol (2)');
assert(prof.insulinToCarbRatioSegments.data[0].value === 8, 'carb ratio unchanged (not a glucose value)');

// --- default + mmol passthrough --------------------------------------------
delete process.env.GLOOKO_GLUCOSE_UNIT;
const def = processUnifiedGlookoData(mmolRaw);
assert(approx(def.filter((x) => x.type === 'CGM')[0].val, 6), 'unset GLOOKO_GLUCOSE_UNIT defaults to mmol (no conversion)');

process.env.GLOOKO_GLUCOSE_UNIT = 'mmol';
const passthrough = getActiveSettings(settingsJson, '2026-05-01', '2026-06-01');
assert(
  passthrough[0].settings.profilesBolus[0].targetBgSegments.data[0].value === 108.0,
  'mmol-source settings are NOT converted (left exactly as delivered)'
);

console.log('\nGlooko source-unit normalisation test complete.');
