/**
 * Orientation guard for basal states, using the real 2026-06-17 arrays.
 *
 * This pins the suspend/normal mapping against ground truth so it can never be
 * silently inverted. On 17 June the raw basalBarAutomated series has its longest
 * delivering block at 05:22-08:47 UTC (205 min), and there is a verified low at
 * 16:26 (3.2 mmol). A correct mapping reports that block as 'normal' (delivering)
 * and places the low inside a 'suspend' interval. An inverted mapping would do
 * the opposite.
 */

import { deriveBasalStates } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

const auto = [1781654400,1781656221,1781658021,1781663228,1781663826,1781665026,1781665626,1781667726,1781669826,1781670426,1781671626,1781672826,1781673126,1781673426,1781673726,1781686026,1781690826,1781691126,1781692026,1781697126,1781697726,1781702226,1781702826,1781704326,1781706126,1781708226,1781709726,1781710926,1781714526,1781716026,1781717826,1781719326,1781721126,1781722026,1781725626,1781726826,1781729526,1781733126,1781737926,1781738226,1781738226,1781740326];
const susp = [1781656221,1781658021,1781665026,1781665626,1781667726,1781669826,1781670426,1781671626,1781672826,1781673126,1781673426,1781673726,1781686026,1781690826,1781691126,1781692026,1781697126,1781697726,1781702226,1781702826,1781704326,1781706126,1781708226,1781709726,1781710926,1781714526,1781716026,1781717826,1781719326,1781721126,1781722026,1781725626,1781726826,1781729526,1781733126,1781737926,1781740326,1781740799];

function bars(xs, type) {
  const p = [];
  for (let i = 0; i < xs.length; i += 2) {
    const s = xs[i], e = xs[i + 1];
    p.push({ type, x: s, y: 0 }, { type, x: s, y: 1 }, { type, x: e, y: 1 }, { type, x: e, y: 0 }, { type, x: e, y: null });
  }
  return p;
}

const raw = { series: {
  basalBarAutomated: bars(auto, 'automated'),
  basalBarAutomatedSuspend: bars(susp, 'automated_suspend'),
  basalBarAutomatedMax: [],
  pumpOp5LimitedMode: [],
}};

const ds = Math.floor(Date.parse('2026-06-17T00:00:00Z') / 1000);
const de = Math.floor(Date.parse('2026-06-17T23:59:59Z') / 1000);
const iv = deriveBasalStates(raw, ds, de);

const normals = iv.filter((i) => i.state === 'normal');
const longest = normals.reduce((a, b) => (b.endEpoch - b.startEpoch) > (a.endEpoch - a.startEpoch) ? b : a);
const startHHMM = new Date(longest.startEpoch * 1000).toISOString().substring(11, 16);
const endHHMM = new Date(longest.endEpoch * 1000).toISOString().substring(11, 16);

assert(startHHMM === '05:22' && endHHMM === '08:47',
  `longest delivering run is 05:22-08:47 (got ${startHHMM}-${endHHMM}) — NOT inverted`);
assert(Math.round((longest.endEpoch - longest.startEpoch) / 60) === 205,
  'longest delivering run is 205 minutes');

const low = Math.floor(Date.parse('2026-06-17T16:26:47Z') / 1000);
const hit = iv.find((i) => low >= i.startEpoch && low < i.endEpoch);
assert(hit && hit.state === 'suspend',
  `verified 16:26 low falls inside a suspend interval (got ${hit ? hit.state : 'none'}) — confirms correct orientation`);

console.log('\nBasal orientation test complete.');

// --- Regression: series that STARTS MID-BAR (the June 17 inversion bug) ------
// The real basalBarAutomatedSuspend array begins at 00:30 as a FALLING edge
// (closing a bar that opened before the window), not a rising one. The old
// positional (0,1),(2,3) pairing read this as (start,end) and inverted every
// interval into the gaps. The edge-aware parser keys off the y rise/fall so it
// gets the bars right. This fixture reproduces that exact shape in miniature.
import { deriveBasalStates as derive2 } from '../src/analytics.js';

// Automated bar on 00:00-00:30 (delivering), then 01:00-02:00.
const auto2 = [
  { type: 'automated', x: 0, y: 0 }, { type: 'automated', x: 0, y: 1 },
  { type: 'automated', x: 1800, y: 1 }, { type: 'automated', x: 1800, y: 0 }, { type: 'automated', x: 1800, y: null },
  { type: 'automated', x: 3600, y: 0 }, { type: 'automated', x: 3600, y: 1 },
  { type: 'automated', x: 7200, y: 1 }, { type: 'automated', x: 7200, y: 0 }, { type: 'automated', x: 7200, y: null },
];
// Suspend series whose FIRST point is a falling edge at 00:30 (bar opened pre-window),
// then a real suspend bar 00:30-01:00.
const susp2 = [
  { type: 'automated_suspend', x: 1800, y: 0 }, { type: 'automated_suspend', x: 1800, y: 1 },
  { type: 'automated_suspend', x: 3600, y: 1 }, { type: 'automated_suspend', x: 3600, y: 0 }, { type: 'automated_suspend', x: 3600, y: null },
];
const raw2 = { series: { basalBarAutomated: auto2, basalBarAutomatedSuspend: susp2, basalBarAutomatedMax: [], pumpOp5LimitedMode: [] } };
const iv2 = derive2(raw2, 0, 7200);
const at = (t) => iv2.find((i) => t >= i.startEpoch && t < i.endEpoch);
assert(at(900).state === 'normal', `00:15 is normal/delivering (got ${at(900).state}) — not inverted`);
assert(at(2700).state === 'suspend', `00:45 is suspend (got ${at(2700).state}) — the mid-bar-start bar`);
assert(at(5400).state === 'normal', `01:30 is normal/delivering (got ${at(5400).state})`);

console.log('Mid-bar-start regression test complete.');
