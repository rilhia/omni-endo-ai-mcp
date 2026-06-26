/**
 * Tests downsampleForChart, whose whole reason to exist is cutting the volume
 * that reaches the model when drawing a chart. So the key assertions are:
 *   - a wide window of thousands of readings collapses to ~maxPoints,
 *   - a sharp spike between samples survives as a bucket max (the band),
 *   - bolus events come back as separate markers, not folded into the line,
 *   - a short window (fewer readings than the cap) keeps full fidelity,
 *   - points are spaced by TIME, so coverage gaps don't distort the x-axis.
 */

import { downsampleForChart } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
}

// Build a week of 5-min CGM (~2016 readings) at a gentle baseline, with one
// sharp single-reading spike to 16.0 buried mid-week, and a few boluses.
const start = Date.UTC(2026, 4, 1, 0, 0, 0) / 1000;
const timeline = [];
const WEEK_READINGS = 7 * 288;
let spikeEpoch = null;
for (let i = 0; i < WEEK_READINGS; i++) {
  const epoch = start + i * 300;
  let val = 6.5 + Math.sin(i / 50) * 0.5; // gentle wave
  if (i === 1000) {
    val = 16.0; // single sharp spike
    spikeEpoch = epoch;
  }
  timeline.push({ epoch, type: 'CGM', val: +val.toFixed(2) });
}
// A few boluses
for (const h of [8, 13, 19]) {
  timeline.push({
    epoch: start + h * 3600,
    type: 'BOLUS',
    units: 3.5,
    carbs: 40,
    class: 'Meal Bolus',
  });
}
timeline.sort((a, b) => a.epoch - b.epoch);

// --- downsample to 250 ----------------------------------------------------
const out = downsampleForChart(timeline, 250);

assert(timeline.filter((i) => i.type === 'CGM').length > 2000, 'fixture has >2000 raw readings');
assert(out.points.length <= 250 && out.points.length >= 200, `downsampled to ~250 points (got ${out.points.length})`);

// Volume reduction: serialized size should shrink dramatically.
const rawSize = JSON.stringify(timeline.filter((i) => i.type === 'CGM')).length;
const dsSize = JSON.stringify(out.points).length;
const ratio = rawSize / dsSize;
assert(ratio > 5, `downsampled payload is much smaller (${ratio.toFixed(1)}x reduction)`);

// The spike must survive as a bucket max even though its average is diluted.
const spikeBucket = out.points.find((p) => p.max >= 15.9);
assert(!!spikeBucket, 'sharp spike preserved as a bucket max (the band)');
assert(spikeBucket.avg < spikeBucket.max, 'spike bucket avg is below its max, i.e. band is meaningful');

// Boluses returned as separate markers.
assert(out.boluses.length === 3, 'three bolus markers returned separately');
assert(out.boluses.every((b) => b.t && b.class), 'bolus markers carry time and class');

// Even time spacing: gaps between consecutive point timestamps should be ~uniform.
const ts = out.points.map((p) => Date.parse(p.t));
const gaps = ts.slice(1).map((t, i) => t - ts[i]);
const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
const maxDev = Math.max(...gaps.map((g) => Math.abs(g - meanGap)));
assert(maxDev < meanGap * 0.5, 'points are roughly evenly spaced in time');

// --- short window passthrough ---------------------------------------------
const shortTimeline = timeline.filter((i) => i.epoch < start + 3 * 3600); // 3 hours
const shortOut = downsampleForChart(shortTimeline, 250);
const shortCgm = shortTimeline.filter((i) => i.type === 'CGM').length;
assert(shortOut.points.length === shortCgm, 'short window (< cap) keeps every reading, full fidelity');
assert(shortOut.points.every((p) => p.n === 1), 'short-window points are single readings');

console.log('\nDownsample summary:');
console.log(`  raw CGM readings: ${timeline.filter((i) => i.type === 'CGM').length}`);
console.log(`  chart points: ${out.points.length}`);
console.log(`  payload reduction: ${ratio.toFixed(1)}x`);
console.log(`  spike bucket: avg ${spikeBucket.avg}, max ${spikeBucket.max}`);
console.log('\nChart series test complete.');
