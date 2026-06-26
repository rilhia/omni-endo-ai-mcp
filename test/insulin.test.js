/**
 * Tests the daily-insulin feature against the real Glooko response shape
 * (the dailyInsulinTotals block returned when totalInsulinPerDay is requested).
 *
 * Uses the actual values from a real pull: basal 13.8, bolus 17.3, total 31.1
 * for 2026-06-20, and verifies they reconcile and flow through extraction,
 * the summary's basal block (with cross-check against bolus events), and the
 * trend tool's per-bucket basal.
 */

import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs';

const dbFile = path.join(tmpdir(), `omni-insulin-${Date.now()}.db`);
process.env.OMNI_DB_PATH = dbFile;

const {
  extractDailyInsulin,
  computeSummary,
  bucketTrend,
  getThresholds,
} = await import('../src/analytics.js');
const { ingestDailyInsulin, getDailyInsulin, _wipe } = await import('../src/store.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
}

// --- 1. extraction from real shape ----------------------------------------
// dailyInsulinTotals lives UNDER series in the real response (confirmed from
// the live payload), so the fixture must nest it there too.
const realResponse = {
  series: {
    cgmHigh: [],
    cgmLow: [],
    cgmNormal: [],
    deliveredBolus: [],
    dailyInsulinTotals: {
      '1781956800': {
        totalOtherInsulinPerDay: 0.0,
        totalPumpInsulinPerDay: 31.1,
        hasPump: true,
        hasPen: false,
        totalInsulinPerDay: 31.1,
        bolusUnitsPerDay: 17.3,
        basalUnitsPerDay: 13.8,
        premixedUnitsPerDay: 0.0,
      },
    },
  },
};

const extracted = extractDailyInsulin(realResponse);
assert(extracted.length === 1, 'extracted one daily-insulin record');
assert(extracted[0].dayUtc === '2026-06-20', `day key is 2026-06-20 (got ${extracted[0].dayUtc})`);
assert(extracted[0].basalUnits === 13.8, 'basal 13.8 extracted');

// Structural guard: the block MUST be read from series.dailyInsulinTotals.
// A block placed at the top level (the old wrong assumption) must yield nothing,
// and the correctly-nested block must yield a record. This is the exact bug that
// shipped: parser read rawJson.dailyInsulinTotals instead of rawJson.series....
assert(
  extractDailyInsulin({ dailyInsulinTotals: { '1781956800': { totalInsulinPerDay: 99 } } }).length === 0,
  'top-level dailyInsulinTotals is NOT picked up (must be under series)'
);
assert(
  extractDailyInsulin({ series: { dailyInsulinTotals: { '1781956800': { totalInsulinPerDay: 47.7, basalUnitsPerDay: 16.8, bolusUnitsPerDay: 31.0 } } } }).length === 1,
  'series-nested dailyInsulinTotals IS picked up'
);
assert(extracted[0].bolusUnits === 17.3, 'bolus 17.3 extracted');
assert(extracted[0].totalUnits === 31.1, 'total 31.1 extracted');
assert(
  Math.abs(extracted[0].basalUnits + extracted[0].bolusUnits - extracted[0].totalUnits) < 0.01,
  'basal + bolus reconciles to total (13.8 + 17.3 = 31.1)'
);

// --- 2. storage + completeness --------------------------------------------
_wipe();
// Treat 2026-06-20 as a PAST day relative to a later "today" so it stores complete.
ingestDailyInsulin(extracted, '2026-06-25');
const stored = getDailyInsulin(
  Math.floor(Date.parse('2026-06-20T00:00:00Z') / 1000),
  Math.floor(Date.parse('2026-06-20T23:59:59Z') / 1000)
);
assert(stored.length === 1, 'stored and retrieved one day');
assert(stored[0].basalUnits === 13.8 && stored[0].complete === true, 'stored day is complete with basal 13.8');

// Provisional case: same day but "today" == that day -> provisional.
_wipe();
ingestDailyInsulin(extracted, '2026-06-20');
const prov = getDailyInsulin(
  Math.floor(Date.parse('2026-06-20T00:00:00Z') / 1000),
  Math.floor(Date.parse('2026-06-20T23:59:59Z') / 1000)
);
assert(prov[0].complete === false, "today's record stored provisional");

// --- 3. summary basal block + cross-check ---------------------------------
// Build a tiny timeline with bolus events summing near 17.3 to test cross-check.
const base = Date.parse('2026-06-20T12:00:00Z') / 1000;
const timeline = [
  { epoch: base, type: 'BOLUS', units: 13.3, carbs: 80, class: 'Meal Bolus' },
  { epoch: base + 3600, type: 'BOLUS', units: 2.0, carbs: 0, class: 'Manual Correction Bolus' },
  { epoch: base + 7200, type: 'BOLUS', units: 2.0, carbs: 0, class: 'Manual Correction Bolus' },
  // a little CGM so the summary has glucose too
  { epoch: base, type: 'CGM', val: 7.0 },
  { epoch: base + 300, type: 'CGM', val: 7.5 },
];
const summary = computeSummary(
  timeline,
  null,
  [],
  getThresholds('mmol', 3.9, 10.0),
  'mmol/L',
  'exact',
  getDailyInsulin(
    Math.floor(Date.parse('2026-06-20T00:00:00Z') / 1000),
    Math.floor(Date.parse('2026-06-20T23:59:59Z') / 1000)
  )
);

// Bolus is aggregated from events (13.3+2+2 = 17.3), not from Glooko.
assert(summary.insulin.bolusSource === 'archive-events', 'summary bolus is from archive events');
assert(Math.abs(summary.insulin.bolusUnits - 17.3) < 0.01, 'summary bolus units = 17.3 (from events)');
assert(summary.insulin.bolusEventCount === 3, 'summary counts 3 bolus events');
// Basal: all basal days included (here just the one day, 13.8).
assert(summary.insulin.basalSource === 'glooko-daily', 'summary basal is from Glooko daily');
assert(Math.abs(summary.insulin.basalUnits - 13.8) < 0.01, 'summary basal units = 13.8 (all included)');
assert(summary.insulin.basalDayCount === 1, 'one basal day counted');
assert(Math.abs(summary.insulin.averageBasalUnitsPerDay - 13.8) < 0.01, 'avg basal per day = 13.8');
assert(typeof summary.insulin.basalPercent === 'number', 'summary has basal percentage');
assert(summary.insulin.partialDayBasal === undefined, 'no partial-day block (simplified)');

// --- 4. trend per-bucket basal --------------------------------------------
const daily = getDailyInsulin(
  Math.floor(Date.parse('2026-06-20T00:00:00Z') / 1000),
  Math.floor(Date.parse('2026-06-20T23:59:59Z') / 1000)
);
const rows = bucketTrend(
  timeline,
  getThresholds('mmol', 3.9, 10.0),
  {
    mode: 'calendar',
    granularity: 'month',
    windowStart: base,
    windowEnd: base + 86400,
  },
  daily
);
const june = rows.find((r) => r.bucket === '2026-06');
assert(!!june, 'trend produced a 2026-06 bucket');
assert(june.insulin.bolusSource === 'archive-events', 'trend bucket bolus is from events');
assert(Math.abs(june.insulin.bolusUnits - 17.3) < 0.01, 'trend bucket bolus units = 17.3');
assert(june.insulin.basalSource === 'glooko-daily', 'trend bucket basal is from Glooko daily');
assert(Math.abs(june.insulin.basalUnits - 13.8) < 0.01, 'trend bucket basal = 13.8 (all included)');
assert(june.insulin.basalDayCount === 1, 'trend bucket counts 1 basal day');

console.log('\nSummary insulin block:', JSON.stringify(summary.insulin, null, 2));

try { fs.unlinkSync(dbFile); fs.unlinkSync(dbFile + '-wal'); fs.unlinkSync(dbFile + '-shm'); } catch {}
console.log('\nDaily insulin test complete.');
