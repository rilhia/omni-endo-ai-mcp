/**
 * Tests bucketTrend, focusing on the correctness property that motivated it:
 * each bucket is aggregated from raw readings, so buckets with different reading
 * counts are still individually accurate, and the overall picture cannot be
 * faked by averaging averages.
 *
 * Fixture: 3 calendar months of CGM. Month A is fully covered at a steady 6.0.
 * Month B has heavy dropout (only a few readings) at 12.0. If someone naively
 * averaged the two monthly averages they'd get 9.0; the true reading-weighted
 * average is far closer to 6.0 because B has hardly any readings. The per-month
 * rows must each reflect their own data, and coverage must expose B as sparse.
 */

import { bucketTrend, getThresholds } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
}

const thresholds = getThresholds('mmol', 3.9, 10.0);

function monthEpochs(year, monthIdx0) {
  return Date.UTC(year, monthIdx0, 1) / 1000;
}

const timeline = [];

// Month A: 2026-01, full coverage at 6.0 (in range). 28 days * 288 readings.
let base = monthEpochs(2026, 0);
for (let day = 0; day < 28; day++) {
  for (let i = 0; i < 288; i++) {
    timeline.push({
      epoch: base + day * 86400 + i * 300,
      type: 'CGM',
      val: 6.0,
    });
  }
}
// One meal bolus per day in month A
for (let day = 0; day < 28; day++) {
  timeline.push({
    epoch: base + day * 86400 + 8 * 3600,
    type: 'BOLUS',
    units: 4.0,
    carbs: 40,
    class: 'Meal Bolus',
  });
}

// Month B: 2026-02, SPARSE coverage at 12.0 (high). Only 10 readings all month.
base = monthEpochs(2026, 1);
for (let i = 0; i < 10; i++) {
  timeline.push({ epoch: base + i * 3600, type: 'CGM', val: 12.0 });
}

// Month C: 2026-03, moderate coverage at 8.0 (in range). 14 days.
base = monthEpochs(2026, 2);
for (let day = 0; day < 14; day++) {
  for (let i = 0; i < 288; i++) {
    timeline.push({ epoch: base + day * 86400 + i * 300, type: 'CGM', val: 8.0 });
  }
}

timeline.sort((a, b) => a.epoch - b.epoch);

// --- calendar / month -----------------------------------------------------
const months = bucketTrend(timeline, thresholds, {
  mode: 'calendar',
  granularity: 'month',
  windowStart: timeline[0].epoch,
  windowEnd: timeline[timeline.length - 1].epoch,
});

assert(months.length === 3, 'three monthly buckets produced');

const [a, b, c] = months;
assert(a.bucket === '2026-01' && b.bucket === '2026-02' && c.bucket === '2026-03', 'buckets are chronological calendar months');
assert(a.glucose.avg === 6.0, 'month A average is 6.0 from its own readings');
assert(b.glucose.avg === 12.0, 'month B average is 12.0 from its own readings');
assert(c.glucose.avg === 8.0, 'month C average is 8.0 from its own readings');

assert(a.glucose.cgmReadingCount === 28 * 288, 'month A reading count correct');
assert(b.glucose.cgmReadingCount === 10, 'month B reading count correct (sparse)');

// Coverage must expose B as untrustworthy and A as solid.
assert(a.coverage.trustworthy === true, 'month A flagged trustworthy');
assert(b.coverage.trustworthy === false, 'month B flagged NOT trustworthy (sparse)');
assert(b.coverage.coveragePercent < 20, 'month B coverage percentage is low');

// The reading-weighted truth: a naive average-of-averages would be (6+12+8)/3 = 8.67.
// The correct reading-weighted mean is dominated by the well-covered months.
const totalSum = timeline.filter((i) => i.type === 'CGM').reduce((s, i) => s + i.val, 0);
const totalCount = timeline.filter((i) => i.type === 'CGM').length;
const trueMean = totalSum / totalCount;
const naiveMean = (a.glucose.avg + b.glucose.avg + c.glucose.avg) / 3;
assert(Math.abs(trueMean - 6.6) < 0.2, `true reading-weighted mean ~6.6 (got ${trueMean.toFixed(2)})`);
assert(Math.abs(naiveMean - 8.67) < 0.1, `naive average-of-averages ~8.67 (got ${naiveMean.toFixed(2)})`);
assert(Math.abs(trueMean - naiveMean) > 1.5, 'naive average-of-averages is materially WRONG vs reading-weighted truth, proving why per-bucket sum/count matters');

// Insulin/carbs in month A
assert(a.insulin.bolusEventCount === 28, 'month A bolus events counted');
assert(a.carbs.carbsGrams === 28 * 40, 'month A carbs summed');

// --- fixed mode -----------------------------------------------------------
const fixed = bucketTrend(timeline, thresholds, {
  mode: 'fixed',
  fixedSizeDays: 7,
  windowStart: timeline[0].epoch,
  windowEnd: timeline[timeline.length - 1].epoch,
});
assert(fixed.length >= 8, 'fixed 7-day buckets span the ~10 weeks of data');

console.log('\nMonthly buckets (avg / readings / coverage%):');
for (const m of months) {
  console.log(`  ${m.bucket}: avg ${m.glucose.avg}, ${m.glucose.cgmReadingCount} readings, ${m.coverage.coveragePercent}% coverage, trustworthy=${m.coverage.trustworthy}`);
}
console.log(`\nReading-weighted mean: ${trueMean.toFixed(2)} | naive avg-of-avgs: ${naiveMean.toFixed(2)}`);
console.log('\nTrend bucketing test complete.');
