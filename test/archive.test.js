/**
 * Tests the archive-backed range layer end to end, with Glooko mocked so we can
 * count fetches and assert that past data is not re-pulled.
 *
 * Strategy: we don't go through glooko.js's network code here. Instead we
 * inject a fake fetchGlookoRange by replacing the module's export via a small
 * shim: range.js imports fetchGlookoRange from './glooko.js', so we monkeypatch
 * using a loader that points './glooko.js' at a stub. Simpler: we import range
 * after setting an env that the stub reads. To keep it dependency-free, this
 * test imports the stub-backed range module directly.
 */

import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs';

// Point the archive at a throwaway file BEFORE importing anything that opens it.
const dbFile = path.join(tmpdir(), `omni-test-${Date.now()}.db`);
process.env.OMNI_DB_PATH = dbFile;
process.env.GLOOKO_EMAIL = process.env.GLOOKO_EMAIL || 'test@offline';
process.env.GLOOKO_PASSWORD = process.env.GLOOKO_PASSWORD || 'testpass';

// Build a synthetic day of Glooko-shaped data for a given UTC date.
function syntheticGlookoDay(dateStr) {
  const dayStart = Date.parse(dateStr + 'T00:00:00.000Z') / 1000;
  const cgmNormal = [];
  const cgmHigh = [];
  for (let i = 0; i < 288; i++) {
    const epoch = dayStart + i * 300;
    const hour = new Date(epoch * 1000).getUTCHours();
    let val = 6.5;
    if (hour >= 18 && hour < 22) val = 12.0; // evening highs
    const p = { x: epoch, y: val };
    if (val > 10) cgmHigh.push(p);
    else cgmNormal.push(p);
  }
  const deliveredBolus = [
    {
      x: dayStart + 8 * 3600,
      y: 4.0,
      carbsInput: 40,
      isManual: false,
      insulinOnBoard: 0,
      insulinRecommendationForCorrection: 0,
    },
  ];
  return { series: { cgmHigh, cgmLow: [], cgmNormal, deliveredBolus } };
}

// Track Glooko calls and the spans requested.
const fetchLog = [];

// Stub fetchGlookoRange by intercepting the module. We use Node's loader-free
// approach: dynamically import range.js but first replace glooko.js's export
// through the global registry the module reads. Since range.js binds the import
// at load, we instead set a global the stub module checks.
globalThis.__OMNI_FETCH_STUB__ = async (startISO, endISO) => {
  fetchLog.push({ startISO, endISO, days: (Date.parse(endISO) - Date.parse(startISO)) / 86400000 });
  // Return all days in the requested span.
  const out = { series: { cgmHigh: [], cgmLow: [], cgmNormal: [], deliveredBolus: [] }, stats: null, settings: { deviceSettings: { pumps: {} } } };
  let cur = new Date(Date.parse(startISO));
  cur.setUTCHours(0, 0, 0, 0);
  const endEpoch = Date.parse(endISO);
  while (cur.getTime() <= endEpoch) {
    const day = syntheticGlookoDay(cur.toISOString().split('T')[0]);
    out.series.cgmHigh.push(...day.series.cgmHigh);
    out.series.cgmNormal.push(...day.series.cgmNormal);
    out.series.deliveredBolus.push(...day.series.deliveredBolus);
    cur = new Date(cur.getTime() + 86400000);
  }
  return { startDate: startISO, endDate: endISO, data1: out, data2: null, data3: { deviceSettings: { pumps: {} } } };
};

// glooko-stub.js (written alongside) reads that global. Repoint the import.
const { getProcessedRange } = await import('../src/range.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
}

// --- Scenario -------------------------------------------------------------
// "now" is dynamic; use fixed past windows so days are complete.
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const iso = (d) => new Date(d).toISOString();
const DAY = 86400000;

// Q1: cold start, ask about a week ~2 months ago (forces cold-start lookback).
const q1Start = iso(today.getTime() - 60 * DAY);
const q1End = iso(today.getTime() - 53 * DAY);
const r1 = await getProcessedRange(q1Start, q1End);
const callsAfterQ1 = fetchLog.length;
assert(r1.timeline.length > 0, 'Q1 returned a timeline from the archive');
assert(callsAfterQ1 >= 1, 'Q1 cold-start triggered at least one Glooko pull');
// The default history floor is now 90 days, so a cold start reaches back ~90
// days regardless of the narrow asked week. Assert it pulled that wide floor
// span, not just the 7 requested days.
const coldSpan = fetchLog[0].days;
assert(coldSpan >= 85, `Q1 cold-start pulled the ~90d default floor span (${coldSpan.toFixed(0)}d), not just the asked week`);

// Q2: ask about a DIFFERENT past week INSIDE the cold-start span. Should need
// no historical re-pull; only a possible top-up to "now".
fetchLog.length = 0;
const q2Start = iso(today.getTime() - 40 * DAY);
const q2End = iso(today.getTime() - 33 * DAY);
const r2 = await getProcessedRange(q2Start, q2End);
assert(r2.timeline.length > 0, 'Q2 served a covered past window');
const q2Spans = fetchLog.map((f) => f.days);
const q2BigPull = q2Spans.some((d) => d > 10);
assert(!q2BigPull, 'Q2 did NOT re-pull historical data (only small top-up, if any)');
console.log('     Q2 fetches:', JSON.stringify(q2Spans.map((d) => +d.toFixed(1))));

// Q3: computed insulin/carb come from archive (stats is null).
fetchLog.length = 0;
const { computeSummary, getThresholds } = await import('../src/analytics.js');
const r3 = await getProcessedRange(q1Start, q1End);
const summary = computeSummary(r3.timeline, r3.stats, r3.settingsHistory, getThresholds('mmol', 3.9, 10.0), 'mmol/L', 'exact', r3.dailyInsulin);
assert(r3.stats === null, 'archive returns stats=null by design');
assert(
  summary.insulin.bolusSource === 'archive-events',
  'insulin bolus aggregated from archive events'
);
assert(
  summary.insulin.bolusEventCount > 0,
  'counted bolus events from stored rows'
);
assert(
  summary.carbs.carbsGrams > 0,
  'computed carbs from stored bolus rows'
);
assert(
  summary.glucoseControl.timeHigh > 0,
  'glucose metrics recomputed from archived window'
);

console.log('\nComputed insulin block:', JSON.stringify(summary.insulin));
console.log('Computed carbs block  :', JSON.stringify(summary.carbs));

// Cleanup
try { fs.unlinkSync(dbFile); fs.unlinkSync(dbFile + '-wal'); fs.unlinkSync(dbFile + '-shm'); } catch {}
console.log('\nArchive flow test complete.');
