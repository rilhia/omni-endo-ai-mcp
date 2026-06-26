/**
 * Tests the aggregation logic used by the get_daily_insulin tool: per-day
 * rounding, window totals, per-day averages, the basal-to-bolus split, and
 * provisional-day flagging.
 *
 * The single-day figures are the real 2026-06-20 totals from Glooko:
 * basal 16.8, bolus 31.0, total 47.7. The two-day case adds the real
 * 2026-06-19-style values to check averaging and the basal percent.
 *
 * This mirrors the pure computation inside the tool handler (kept in step with
 * src/server.js). The DB-backed path is covered by the handshake/archive tests.
 */

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

// The exact aggregation the tool performs over getDailyInsulin() rows.
function aggregate(days) {
  const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const withValues = days.filter((d) => d.totalUnits != null);
  const sum = (key) => withValues.reduce((a, d) => a + (d[key] || 0), 0);
  const n = withValues.length;
  const provisional = days.filter((d) => !d.complete).map((d) => d.dayUtc);
  return {
    days: days.map((d) => ({
      date: d.dayUtc,
      basalUnits: round(d.basalUnits),
      bolusUnits: round(d.bolusUnits),
      totalUnits: round(d.totalUnits),
      provisional: !d.complete,
    })),
    aggregate: n
      ? {
          daysWithData: n,
          totalBasalUnits: round(sum('basalUnits')),
          totalBolusUnits: round(sum('bolusUnits')),
          totalUnits: round(sum('totalUnits')),
          avgDailyBasalUnits: round(sum('basalUnits') / n),
          avgDailyBolusUnits: round(sum('bolusUnits') / n),
          avgDailyTotalUnits: round(sum('totalUnits') / n),
          basalPercent:
            sum('totalUnits') > 0
              ? Math.round((sum('basalUnits') / sum('totalUnits')) * 100)
              : null,
        }
      : null,
    provisional,
  };
}

// --- Single real day: 2026-06-20 -----------------------------------------
let r = aggregate([
  { dayUtc: '2026-06-20', basalUnits: 16.8, bolusUnits: 31.0, totalUnits: 47.7, complete: true },
]);
assert(r.days[0].totalUnits === 47.7, 'June 20 total 47.7 preserved');
assert(r.aggregate.totalBasalUnits === 16.8, 'window basal total 16.8');
assert(r.aggregate.totalBolusUnits === 31.0, 'window bolus total 31.0');
assert(r.aggregate.basalPercent === 35, `basal percent 35 (16.8/47.7) (got ${r.aggregate.basalPercent})`);
assert(r.days[0].provisional === false, 'complete day not flagged provisional');

// --- Two days: averaging --------------------------------------------------
r = aggregate([
  { dayUtc: '2026-06-19', basalUnits: 13.8, bolusUnits: 17.3, totalUnits: 31.1, complete: true },
  { dayUtc: '2026-06-20', basalUnits: 16.8, bolusUnits: 31.0, totalUnits: 47.7, complete: true },
]);
assert(r.aggregate.daysWithData === 2, 'two days counted');
assert(r.aggregate.totalUnits === 78.8, `two-day total 78.8 (got ${r.aggregate.totalUnits})`);
assert(r.aggregate.avgDailyTotalUnits === 39.4, `avg daily total 39.4 (got ${r.aggregate.avgDailyTotalUnits})`);
assert(r.aggregate.avgDailyBasalUnits === 15.3, `avg daily basal 15.3 (got ${r.aggregate.avgDailyBasalUnits})`);

// --- Provisional day ------------------------------------------------------
r = aggregate([
  { dayUtc: '2026-06-20', basalUnits: 16.8, bolusUnits: 31.0, totalUnits: 47.7, complete: true },
  { dayUtc: '2026-06-21', basalUnits: 4.2, bolusUnits: 6.0, totalUnits: 10.2, complete: false },
]);
assert(r.days[1].provisional === true, 'incomplete day flagged provisional');
assert(r.provisional.length === 1 && r.provisional[0] === '2026-06-21', 'provisional list names the day');

// --- Empty window ---------------------------------------------------------
r = aggregate([]);
assert(r.aggregate === null, 'empty window yields null aggregate, no throw');

console.log('\nDaily insulin tool aggregation test complete.');
