/**
 * Coverage-policy tests for ensureCoverage (via getProcessedRange): data is
 * served from the archive and Glooko is touched ONLY to fill a genuine gap,
 * either older than the stored history or meaningfully newer than the freshest
 * stored reading. Near-now requests within the freshness tolerance must NOT
 * refetch (CGM always lags now), and a fully-covered window must make zero
 * fetches.
 */

process.env.OMNI_DB_PATH = process.env.OMNI_DB_PATH || '/tmp/coverage_test.db';
process.env.OMNI_OLDEST_DATE = '2025-06-01';

process.env.GLOOKO_EMAIL = process.env.GLOOKO_EMAIL || 'test@offline';
process.env.GLOOKO_PASSWORD = process.env.GLOOKO_PASSWORD || 'testpass';
import { initDb, _wipe } from '../src/store.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

const now = Math.floor(Date.now() / 1000);
const DATA_START = Math.floor(Date.parse('2025-06-01') / 1000);
let fetches = [];
let DATA_END = now; // how fresh the stub's data reaches

globalThis.__OMNI_FETCH_STUB__ = async (startDate, endDate) => {
  const s = Math.floor(Date.parse(startDate) / 1000);
  const e = Math.floor(Date.parse(endDate) / 1000);
  fetches.push([s, e]);
  const from = Math.max(s, DATA_START);
  const cgmNormal = [];
  for (let t = from; t <= Math.min(e, DATA_END); t += 300) {
    cgmNormal.push({ x: t, y: 6.5, timestamp: new Date(t * 1000).toISOString(), calculated: false });
  }
  return { data1: { series: { cgmHigh: [], cgmLow: [], cgmNormal, deliveredBolus: [], dailyInsulinTotals: {},
    basalBarAutomated: [], basalBarAutomatedSuspend: [], basalBarAutomatedMax: [] } }, data2: null, data3: null };
};

const { getProcessedRange } = await import('../src/range.js');
const iso = (daysAgo) => new Date((now - daysAgo * 86400) * 1000).toISOString();

initDb();
_wipe();

// 1. Cold start on empty archive
await getProcessedRange(iso(7), iso(0));
assert(fetches.length >= 1, 'empty archive triggers a cold-start pull');

// 2. Same window again, fully covered & near-now: ZERO fetches
fetches = [];
await getProcessedRange(iso(7), iso(0));
assert(fetches.length === 0, 'fully-covered near-now window makes no fetch (freshness tolerance)');

// 3. A historical window within the loaded range: ZERO fetches
fetches = [];
await getProcessedRange(iso(200), iso(195));
assert(fetches.length === 0, 'window inside loaded history makes no fetch');

// 4. Genuine NEWER gap: wipe, cold-start with data stopping 3 days ago, then
//    ask about now -> must pull the gap.
_wipe();
DATA_END = now - 3 * 86400;
await getProcessedRange(iso(7), iso(4)); // cold start, data only to 3d ago
fetches = [];
await getProcessedRange(iso(2), iso(0)); // asks past coverage by ~3 days
assert(fetches.length >= 1, 'a real newer gap (3 days) triggers a pull');

// 5. After the gap is filled, the same question is covered: ZERO fetches
DATA_END = now;
await getProcessedRange(iso(2), iso(0)); // fills to now
fetches = [];
await getProcessedRange(iso(2), iso(0));
assert(fetches.length === 0, 'once the gap is filled, repeat question makes no fetch');

// 6. OLDER gap: ask before the floor -> backfill once.
fetches = [];
await getProcessedRange(iso(500), iso(495)); // older than 2025-06-01 floor
assert(fetches.length >= 1, 'a window older than the loaded floor triggers a backfill');

console.log('\nCoverage policy test complete.');
