/**
 * Pins the widened bolus fields end to end (parse -> store -> read), using real
 * 2026-05-17 deliveredBolus entries:
 *   - an override-above correction (algorithm said 0.9, user gave 1.5, BG 9.0 CGM)
 *   - a clean meal bolus (recommendation all carb, no correction)
 *   - an interrupted bolus (delivered 2.0 < programmed 3.0)
 *
 * These guard against silent regressions in extracting delivered vs programmed,
 * the recommendation split, override direction, the interrupted flag, and the
 * BG-input fields, the data needed for proper bolus-behaviour analysis.
 */

process.env.OMNI_DB_PATH = process.env.OMNI_DB_PATH || '/tmp/bolus_fields_test.db';

import { initDb, ingestTimeline, getTimeline, _wipe } from '../src/store.js';
import { processUnifiedGlookoData } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

initDb();
_wipe();

const data1 = { series: { cgmHigh: [], cgmLow: [], cgmNormal: [], deliveredBolus: [
  { isInterrupted: false, isOverrideAbove: true, isOverrideBelow: false, isManual: false, x: 1778981045, y: 1.5, carbsInput: 0.0, insulinDelivered: 1.5, totalInsulinRecommendation: 0.9, insulinProgrammed: 1.5, insulinRecommendationForCorrection: 0.9, insulinRecommendationForCarbs: 0.0, insulinOnBoard: 0.8, bloodGlucoseInput: 9.0, bloodGlucoseInputSource: 'CGM', type: 'suggested' },
  { isInterrupted: false, isOverrideAbove: false, isOverrideBelow: false, isManual: false, x: 1779045167, y: 9.3, carbsInput: 70.0, insulinDelivered: 9.3, totalInsulinRecommendation: 9.3, insulinProgrammed: 9.3, insulinRecommendationForCorrection: 0.0, insulinRecommendationForCarbs: 9.3, insulinOnBoard: 0.0, bloodGlucoseInput: null, bloodGlucoseInputSource: null, type: 'suggested' },
  { isInterrupted: true, isManual: true, x: 1779061373, y: 3.0, carbsInput: 0.0, insulinDelivered: 2.0, totalInsulinRecommendation: 0.0, insulinProgrammed: 3.0, insulinRecommendationForCorrection: 0.0, insulinRecommendationForCarbs: 0.0, insulinOnBoard: 2.05, bloodGlucoseInput: null, bloodGlucoseInputSource: null, type: 'manual' },
]}};

ingestTimeline(processUnifiedGlookoData(data1), []);
const rows = getTimeline(1778976000, 1779062400).filter((b) => b.type === 'BOLUS');
const byEpoch = (e) => rows.find((r) => r.epoch === e);

// Override-above correction
const o = byEpoch(1778981045);
assert(o.delivered === 1.5 && o.programmed === 1.5, 'override bolus delivered/programmed both 1.5');
assert(o.recTotal === 0.9, 'override bolus recTotal 0.9 (algorithm suggestion)');
assert(o.recCorrection === 0.9 && o.recCarbs === 0, 'override bolus recommendation all correction');
assert(o.override === 'above', 'override direction captured as above');
assert(o.bgInput === 9 && o.bgSource === 'CGM', 'override bolus BG input 9 from CGM');
assert(o.interrupted === false, 'override bolus not interrupted');

// Clean meal bolus
const m = byEpoch(1779045167);
assert(m.recCarbs === 9.3 && m.recCorrection === 0, 'meal bolus recommendation all carb');
assert(m.override === null, 'meal bolus no override');

// Interrupted bolus: delivered < programmed
const i = byEpoch(1779061373);
assert(i.delivered === 2.0 && i.programmed === 3.0, 'interrupted bolus delivered 2.0 < programmed 3.0');
assert(i.interrupted === true, 'interrupted flag set when delivered < programmed');
assert(i.isManual === true, 'interrupted bolus marked manual');
assert(i.units === 2.0, 'canonical units follows delivered (2.0), keeping totals honest');

console.log('\nBolus fields test complete.');
