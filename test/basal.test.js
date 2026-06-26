/**
 * Tests deriveBasalStates / summariseBasalStates against the real 2026-06-12
 * Glooko response, which exercises all four states: normal, suspend, a single
 * max window (12:38-12:43), and a limited-mode interval (19:53-20:28) where the
 * pump lost CGM and ran a preset.
 *
 * Verifies the four states tile the day, that limited takes precedence over the
 * suspend it overlaps, and that the max window is captured.
 */

import { deriveBasalStates, summariseBasalStates } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
}

// Minimal reconstruction of the relevant series from the real 2026-06-12 data.
// Bar series: each interval is encoded as a rising then falling pair of x's.
// We give the x-sequence in the order Glooko emits (0,1 ... 1,0,null per bar).
function bars(pairs) {
  // pairs: [[start,end],...] -> emit points the parser expects (x list).
  const pts = [];
  for (const [s, e] of pairs) {
    pts.push({ x: s, y: 0 }, { x: s, y: 1 }, { x: e, y: 1 }, { x: e, y: 0 }, { x: e, y: null });
  }
  return pts;
}

const maxPairs = [[1781267896, 1781268196]]; // 12:38:16 - 12:43:16
const suspendPairs = [
  [1781222596, 1781226496],
  [1781276896, 1781281696],
  [1781293997, 1781296096], // overlaps the limited window below
  [1781296396, 1781300597],
];
const normalPairs = [
  [1781222400, 1781222596],
  [1781226496, 1781229196],
  [1781268196, 1781270596], // after max
];

const rawJson = {
  series: {
    basalBarAutomatedSuspend: bars(suspendPairs),
    basalBarAutomatedMax: bars(maxPairs),
    basalBarAutomated: bars(normalPairs),
    pumpOp5LimitedMode: [
      {
        type: 'limited',
        timestamp: '2026-06-12T19:53:17.000Z', // 1781293997
        endTimestamp: '2026-06-12T20:28:16.000Z', // 1781296096
      },
    ],
  },
};

const dayStart = 1781222400;
const dayEnd = 1781308799;
const intervals = deriveBasalStates(rawJson, dayStart, dayEnd);

assert(intervals.length > 0, 'derived basal-state intervals');

// Max window present.
const maxIv = intervals.find((i) => i.state === 'max');
assert(!!maxIv, 'max state interval present');
assert(
  maxIv.start === '2026-06-12T12:38:16.000Z',
  `max starts at 12:38:16 (got ${maxIv.start})`
);

// Limited window present and exact.
const limIv = intervals.find((i) => i.state === 'limited');
assert(!!limIv, 'limited state interval present');
assert(
  limIv.start === '2026-06-12T19:53:17.000Z' && limIv.end === '2026-06-12T20:28:16.000Z',
  'limited interval matches the mode timestamps exactly'
);

// Precedence: the suspend interval 19:53:17-20:28:16 overlaps limited entirely,
// so that span must be reported limited, NOT suspend.
const suspendOverlappingLimited = intervals.find(
  (i) =>
    i.state === 'suspend' &&
    i.startEpoch < 1781296096 &&
    i.endEpoch > 1781293997
);
assert(
  !suspendOverlappingLimited,
  'limited takes precedence: no suspend reported during the limited window'
);

// Coverage: intervals are contiguous and span the whole day with no gaps/overlaps.
let contiguous = true;
for (let i = 1; i < intervals.length; i++) {
  if (intervals[i].startEpoch !== intervals[i - 1].endEpoch) contiguous = false;
}
assert(contiguous, 'intervals are contiguous (no gaps or overlaps)');
assert(
  intervals[0].startEpoch === dayStart &&
    intervals[intervals.length - 1].endEpoch === dayEnd,
  'intervals span the full day'
);

// Summary.
const summary = summariseBasalStates(intervals);
assert(summary.available === true, 'summary available');
assert(summary.max.minutes === 5, `max totals 5 min (got ${summary.max.minutes})`);
assert(summary.limited.minutes === 35, `limited totals ~35 min (got ${summary.limited.minutes})`);
assert(
  summary.normal.percent + summary.suspend.percent + summary.max.percent + summary.limited.percent > 99.5,
  'state percentages sum to ~100'
);
assert(
  /CGM signal/i.test(summary.interpretation.limited),
  'limited interpretation explains the lost-signal meaning'
);

console.log('\nState summary:');
for (const st of ['normal', 'suspend', 'max', 'limited']) {
  console.log(`  ${st}: ${summary[st].minutes} min, ${summary[st].percent}%, ${summary[st].episodes} episodes`);
}
console.log('\nBasal state test complete.');
