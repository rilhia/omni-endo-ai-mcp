/**
 * Offline / archive-only mode. When Glooko credentials are NOT configured, the
 * server must NEVER attempt to log in or fetch: it serves only the database it
 * was shipped with. This is the safety guarantee that lets an example DB be
 * distributed without the server mutating it on a credential-less machine.
 */

process.env.OMNI_DB_PATH = process.env.OMNI_DB_PATH || '/tmp/offline_test.db';
// Ensure NO credentials for this test.
delete process.env.GLOOKO_EMAIL;
delete process.env.GLOOKO_PASSWORD;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

let fetchCalls = 0;
globalThis.__OMNI_FETCH_STUB__ = async () => {
  fetchCalls++;
  return { data1: { series: { cgmNormal: [] } }, data2: null, data3: null };
};

const { glookoConfigured, getProcessedRange } = await import('../src/range.js');

// 1. With no credentials, glookoConfigured() is false.
assert(glookoConfigured() === false, 'no credentials -> glookoConfigured() is false');

// 2. A query against an empty DB makes ZERO fetch attempts (no cold start).
const now = Date.now();
const r = await getProcessedRange(
  new Date(now - 7 * 86400 * 1000).toISOString(),
  new Date(now).toISOString()
);
assert(fetchCalls === 0, 'empty DB + no credentials -> ZERO Glooko fetch attempts (never contacts Glooko)');
assert(Array.isArray(r.timeline), 'still returns a (possibly empty) timeline from the archive, no throw');

// 3. Even a query reaching far back (which would normally backfill) does not fetch.
fetchCalls = 0;
await getProcessedRange(
  new Date(now - 800 * 86400 * 1000).toISOString(),
  new Date(now).toISOString()
);
assert(fetchCalls === 0, 'a deep-history query with no credentials still makes ZERO fetches');

// 4. When credentials ARE present, glookoConfigured() flips to true.
process.env.GLOOKO_EMAIL = 'real@example.com';
process.env.GLOOKO_PASSWORD = 'realpass';
assert(glookoConfigured() === true, 'credentials present -> glookoConfigured() is true');

// 5. Blank/whitespace credentials count as NOT configured.
process.env.GLOOKO_EMAIL = '   ';
process.env.GLOOKO_PASSWORD = '';
assert(glookoConfigured() === false, 'blank credentials -> treated as not configured');

console.log('\nOffline mode test complete.');
