/**
 * Regression test: processUnifiedGlookoData must not throw when the Glooko
 * response omits a series key. A real response can lack cgmLow (a day with no
 * lows), deliveredBolus (no boluses), etc. Because this runs first in
 * pullAndIngest, an unguarded throw here sinks the ENTIRE pull, so nothing,
 * not timeline, basal, or device events, gets stored for that span. This pins
 * the resilience that prevents that whole-pull failure.
 *
 * Note: CGM readings are deduped into 5-minute (300s) buckets, so test epochs
 * are spaced > 300s apart to survive as distinct readings.
 */

import { processUnifiedGlookoData } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

const T = 1781913600; // a real-ish base epoch
let r;

r = processUnifiedGlookoData({ series: { cgmHigh: [{x:T,y:10}], cgmNormal: [{x:T+600,y:6}], deliveredBolus: [] } });
assert(Array.isArray(r) && r.length === 2, `missing cgmLow does not throw (got ${r.length})`);

r = processUnifiedGlookoData({ series: { cgmNormal: [{x:T,y:6}] } });
assert(Array.isArray(r) && r.length === 1, `only cgmNormal present does not throw (got ${r.length})`);

r = processUnifiedGlookoData({ series: {} });
assert(Array.isArray(r) && r.length === 0, 'empty series yields empty timeline');

r = processUnifiedGlookoData({});
assert(Array.isArray(r) && r.length === 0, 'no series key at all yields empty timeline');

r = processUnifiedGlookoData({ series: {
  cgmHigh: [{x:T+1200,y:11}],
  cgmLow:  [{x:T,y:3}],
  cgmNormal: [],
  deliveredBolus: [{x:T+600,y:2,isManual:true,carbsInput:0,insulinRecommendationForCorrection:0,insulinOnBoard:0.5}],
}});
assert(r.length === 3, `mixed series gives 3 records (got ${r.length})`);
assert(r[0].epoch === T && r[r.length-1].epoch === T+1200, 'records sorted by epoch');

console.log('\nResilience test complete.');
