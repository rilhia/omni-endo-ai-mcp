/**
 * Sync module tests. Glooko is stubbed via globalThis.__OMNI_FETCH_STUB__, so
 * these exercise the real cold-start / top-up / lock / staleness logic against
 * synthetic payloads with a known "data starts here" boundary.
 */

process.env.OMNI_DB_PATH = process.env.OMNI_DB_PATH || '/tmp/sync_test.db';
// Floor date: 3 years back, so cold start would walk several year-batches.
process.env.OMNI_OLDEST_DATE = new Date(Date.now() - 3 * 365 * 86400 * 1000)
  .toISOString()
  .split('T')[0];

process.env.GLOOKO_EMAIL = process.env.GLOOKO_EMAIL || 'test@offline';
process.env.GLOOKO_PASSWORD = process.env.GLOOKO_PASSWORD || 'testpass';
import { initDb, _wipe, getStreamMaxima } from '../src/store.js';
import {
  yearBatches,
  resolveOldestEpoch,
  withSyncLock,
  ensureFreshOnFirstCall,
  runTopUp,
  describeStaleness,
  STALENESS_THRESHOLD_SECONDS,
} from '../src/sync.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

// The synthetic "user" only has data from this point onward. Batches entirely
// before it return empty series; batches overlapping it return one CGM point
// per day in the overlap, plus a near-now reading in the most recent batch so
// freshly-synced data reads as fresh (real CGM lands every 5 min).
const DATA_START = Math.floor(Date.now() / 1000) - 400 * 86400; // ~13 months ago

let fetchCalls = [];
globalThis.__OMNI_FETCH_STUB__ = async (startDate, endDate) => {
  const s = Math.floor(Date.parse(startDate) / 1000);
  const e = Math.floor(Date.parse(endDate) / 1000);
  fetchCalls.push([s, e]);
  const now = Math.floor(Date.now() / 1000);
  const from = Math.max(s, DATA_START);
  const cgmNormal = [];
  const dailyInsulinTotals = {};
  for (let t = from; t <= e; t += 86400) {
    cgmNormal.push({ x: t, y: 6.5, timestamp: new Date(t * 1000).toISOString(), calculated: false });
    const midday = Math.floor(t / 86400) * 86400 + 43200;
    dailyInsulinTotals[String(midday)] = {
      totalInsulinPerDay: 40, basalUnitsPerDay: 18, bolusUnitsPerDay: 22,
    };
  }
  // If this batch reaches "now", add a reading a few minutes ago so the newest
  // stored point is genuinely fresh.
  if (e >= now - 86400 && now >= from) {
    cgmNormal.push({ x: now - 300, y: 6.7, timestamp: new Date((now - 300) * 1000).toISOString(), calculated: false });
  }
  return {
    data1: { series: { cgmHigh: [], cgmLow: [], cgmNormal, deliveredBolus: [], dailyInsulinTotals,
      basalBarAutomated: [], basalBarAutomatedSuspend: [], basalBarAutomatedMax: [] } },
    data2: null,
    data3: null,
  };
};

initDb();
_wipe();

// --- 1. yearBatches ---------------------------------------------------------
const yb = yearBatches(0, 365 * 86400 * 2 + 100);
assert(yb.length === 3, `two years + a bit spans 3 batches (got ${yb.length})`);
assert(yb[0][1] - yb[0][0] === 365 * 86400, 'first batch is exactly one year');
assert(yb[yb.length - 1][1] === 365 * 86400 * 2 + 100, 'final batch clamps to end');

// --- 2. resolveOldestEpoch validation --------------------------------------
{
  const saved = process.env.OMNI_OLDEST_DATE;
  process.env.OMNI_OLDEST_DATE = 'not-a-date';
  let threw = false;
  try { resolveOldestEpoch(); } catch { threw = true; }
  assert(threw, 'malformed OMNI_OLDEST_DATE throws');
  process.env.OMNI_OLDEST_DATE = saved;
}

// --- 3. cold start: recent-first, stops after empty pre-history batches -----
// Floor is 3 years back; data starts ~13 months ago. Recent-first batches:
// [~now-1y .. now] (data), [~now-2y .. now-1y] (data at boundary),
// [~now-3y .. now-2y] (empty). Only one empty batch before the floor, so all
// batches get pulled here; the STOP condition is exercised separately below.
await ensureFreshOnFirstCall();
const maxima = getStreamMaxima();
assert(maxima.cgm !== null, 'cold start populated CGM');
assert(maxima.dailyInsulin !== null, 'cold start populated daily insulin (lagging-stream coverage)');
const firstFetch = fetchCalls[0];
const now = Math.floor(Date.now() / 1000);
assert(now - firstFetch[1] < 86400 * 2, 'first fetch is the most recent batch (recent-first)');

// --- 3b. STOP after MAX_EMPTY_BATCHES consecutive empty batches -------------
// Deep floor (5 years) with data only in the last ~13 months means several
// consecutive empty pre-history batches. The walk must stop after 2 empties
// rather than pulling all 5 year-batches.
{
  _wipe();
  const saved = process.env.OMNI_OLDEST_DATE;
  process.env.OMNI_OLDEST_DATE = new Date(Date.now() - 6 * 365 * 86400 * 1000)
    .toISOString().split('T')[0];
  fetchCalls = [];
  await ensureFreshOnFirstCall();
  // 6-year floor => 7 year-batches. Data spans the last ~13 months, so the 3
  // most-recent batches carry data, then 2 consecutive empty batches trigger the
  // stop. The oldest 2 batches must NOT be pulled. So exactly 5 fetches, not 7.
  assert(fetchCalls.length === 5, `stops after 2 empty probes, skips oldest 2 batches: 5 fetches not 7 (made ${fetchCalls.length})`);
  process.env.OMNI_OLDEST_DATE = saved;
}

// --- 4. top-up keys off oldest stream max & is locked -----------------------
fetchCalls = [];
await runTopUp();
assert(fetchCalls.length === 1, 'top-up made a single pull');
const topStart = fetchCalls[0][0];
// Should start near coverage (oldest stream max) minus trailing window, i.e.
// recent, NOT back at DATA_START.
assert(now - topStart < 10 * 86400, 'top-up pulls only a recent trailing window');

// --- 5. lock serialises concurrent syncs -----------------------------------
fetchCalls = [];
let running = 0;
let maxConcurrent = 0;
const slow = () => withSyncLock(async () => {
  running++; maxConcurrent = Math.max(maxConcurrent, running);
  await new Promise((r) => setTimeout(r, 20));
  running--;
});
await Promise.all([slow(), slow(), slow()]);
assert(maxConcurrent === 1, `lock serialises: never more than 1 concurrent (saw ${maxConcurrent})`);

// --- 6. staleness reporting -------------------------------------------------
const fresh = describeStaleness();
assert(fresh.empty === false, 'staleness sees data present');
assert(fresh.stale === false, `freshly-synced data is not stale (age ${fresh.ageHours}h)`);

// Simulate an old archive by checking the threshold logic directly.
assert(STALENESS_THRESHOLD_SECONDS === 7200, 'staleness threshold is 2 hours');

console.log('\nSync module test complete.');
