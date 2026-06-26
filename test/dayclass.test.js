/**
 * Day-boundary and whole/partial-day classification.
 *
 * Two bugs this guards against:
 *  1. The inclusive-end-day bug: a window ending at a day's 00:00 UTC must NOT
 *     count that day (it has no duration inside the window). A 10-day window
 *     was reporting 11 days, inflating insulinDays and understating per-day
 *     rates.
 *  2. Source mixing: bolus must come from archive events only; Glooko's
 *     pre-aggregated bolus must never appear. Basal comes from Glooko daily,
 *     split into whole days (bracketed by data on both adjacent calendar days)
 *     and partial edge days.
 */

import { bucketTrend, getThresholds, isWholeDay, daysWithReadings, observedDaySpan } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

// --- isWholeDay neighbour rule ---------------------------------------------
const daySet = new Set(['2026-05-20', '2026-05-21', '2026-05-22']);
assert(isWholeDay('2026-05-21', daySet) === true, '21st is whole (neighbours 20 and 22 present)');
assert(isWholeDay('2026-05-20', daySet) === false, '20th is partial (no 19th)');
assert(isWholeDay('2026-05-22', daySet) === false, '22nd is partial (no 23rd)');
// interior gap: 24th missing demotes its neighbours
const gapSet = new Set(['2026-05-22', '2026-05-23', '2026-05-25', '2026-05-26']);
assert(isWholeDay('2026-05-23', gapSet) === false, '23rd partial: 24th missing (interior gap)');
assert(isWholeDay('2026-05-25', gapSet) === false, '25th partial: 24th missing (interior gap)');

// --- observedDaySpan is decimal --------------------------------------------
const e0 = Math.floor(Date.parse('2026-05-20T00:02:00Z') / 1000);
const e1 = Math.floor(Date.parse('2026-05-29T23:58:00Z') / 1000);
const span = observedDaySpan([e0, e1]);
assert(span > 9.9 && span < 10, `observed span ~9.99 decimal days (got ${span.toFixed(3)})`);

// --- full trend: source separation + whole/partial basal -------------------
const dayEp = (d, h, m) => Math.floor(Date.parse(`2026-05-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) / 1000);
const tl = [];
for (const d of [20, 21, 22]) {
  for (let h = 0; h < 24; h++) {
    tl.push({ type: 'CGM', epoch: dayEp(d, h, h === 0 ? 2 : h === 23 ? 58 : 0), val: 6 + (h % 5) * 0.5 });
  }
}
tl.push({ type: 'BOLUS', epoch: dayEp(20, 8, 0), units: 5, carbs: 40 });
tl.push({ type: 'BOLUS', epoch: dayEp(21, 8, 0), units: 6, carbs: 50 });
tl.push({ type: 'BOLUS', epoch: dayEp(22, 8, 0), units: 4, carbs: 30 });
const dailyInsulin = [
  { dayUtc: '2026-05-20', basalUnits: 18, bolusUnits: 99, totalUnits: 117 },
  { dayUtc: '2026-05-21', basalUnits: 17, bolusUnits: 99, totalUnits: 116 },
  { dayUtc: '2026-05-22', basalUnits: 19, bolusUnits: 99, totalUnits: 118 },
];
const rows = bucketTrend(tl, getThresholds('mmol', 3.9, 10), { mode: 'calendar', granularity: 'month', windowStart: dayEp(20, 0, 0), windowEnd: dayEp(22, 23, 59), units: 'mmol' }, dailyInsulin);
const ins = rows[0].insulin;

assert(ins.bolusSource === 'archive-events', 'bolus is from events');
assert(ins.bolusUnits === 15, 'bolus summed from events (5+6+4=15)');
assert(!JSON.stringify(ins).includes('99') && !JSON.stringify(ins).includes('297'), 'Glooko pre-aggregated bolus (99/day) is absent');
assert(ins.basalSource === 'glooko-daily', 'basal is from Glooko daily');
assert(ins.basalUnits === 54, 'ALL basal included (18+17+19=54), no exclusions');
assert(ins.basalDayCount === 3, 'basalDayCount counts all 3 basal loads');
assert(ins.averageBasalUnitsPerDay === 18, 'avg basal per basal-day = 54/3 = 18');
assert(ins.partialDayBasal === undefined && ins.totalUnitsWholeDays === undefined, 'no partial/whole split or notes');
assert(typeof ins.basalPercent === 'number' && typeof ins.bolusPercent === 'number', 'basal/bolus percentages present');
assert(Math.abs(ins.basalPercent + ins.bolusPercent - 100) < 0.2, 'basal% + bolus% ≈ 100');
assert(rows[0].carbs.carbsGrams === 120, 'carbs summed from events (40+50+30=120)');

console.log('\nDay-boundary and classification test complete.');
