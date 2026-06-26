/**
 * Offline self-test of the analytics core.
 *
 * Builds a synthetic Glooko-shaped dataset (data1 series, data2 stats,
 * data3 deviceSettings) and runs every transform, so the maths is verified
 * without touching Glooko or needing credentials. The fixture mirrors the
 * field names the original code reads: series.cgmHigh/cgmNormal/cgmLow with
 * {x: epochSeconds, y: mmol}, series.deliveredBolus, and
 * deviceSettings.pumps[guid][timestamp] with the profilesBolus[0] segment shape.
 */

import {
  processUnifiedGlookoData,
  getActiveSettings,
  calculateHourly,
  buildEnrichedBolusLog,
  computeSummary,
  getThresholds,
} from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
}

// --- Build a synthetic day of CGM at 5-min cadence ------------------------
const dayStart = Date.UTC(2026, 5, 18, 0, 0, 0) / 1000; // 2026-06-18 00:00Z
const cgmNormal = [];
const cgmHigh = [];
const cgmLow = [];

for (let i = 0; i < 288; i++) {
  const epoch = dayStart + i * 300;
  const hour = new Date(epoch * 1000).getUTCHours();
  // Engineer an evening rise: higher glucose 18:00-22:00.
  let val = 6.5 + Math.sin(i / 20) * 0.8;
  if (hour >= 18 && hour < 22) val = 12.5 + Math.sin(i / 5) * 1.0; // evening highs
  if (hour >= 3 && hour < 5) val = 3.6; // brief overnight low
  const point = { x: epoch, y: parseFloat(val.toFixed(2)) };
  if (val > 10) cgmHigh.push(point);
  else if (val < 3.9) cgmLow.push(point);
  else cgmNormal.push(point);
}

const deliveredBolus = [
  {
    x: dayStart + 8 * 3600,
    y: 4.2,
    carbsInput: 45,
    isManual: false,
    insulinOnBoard: 0,
    insulinRecommendationForCorrection: 0,
  }, // meal
  {
    x: dayStart + 13 * 3600,
    y: 1.1,
    carbsInput: 0,
    isManual: true,
    insulinOnBoard: 0.3,
    insulinRecommendationForCorrection: 0,
  }, // manual correction
  {
    x: dayStart + 19 * 3600,
    y: 2.0,
    carbsInput: 0,
    isManual: false,
    insulinOnBoard: 0.5,
    insulinRecommendationForCorrection: 1.8,
  }, // system correction (evening)
];

const data1 = { series: { cgmHigh, cgmNormal, cgmLow, deliveredBolus } };

const data2 = {
  totalInsulinPerDay: 38.4,
  basalUnitsPerDay: 20.1,
  basalPercentage: 52,
  bolusUnitsPerDay: 18.3,
  bolusPercentage: 48,
  averageIndividualBolus: 2.6,
  numOfBolusesPerDay: 7,
  carbsPerDay: 150,
  totalCarbs: 150,
  carbEntriesPerDay: 4,
  averageSteps: 8200,
  op5PumpModeAutomaticPercentage: 96,
};

const data3 = {
  deviceSettings: {
    pumps: {
      'pump-guid-1': {
        '2026-06-01T00:00:00.000Z': {
          generalSettings: { activeInsulinTime: 2 },
          basalSettings: { maxBasalRate: 3.0 },
          profilesBolus: [
            {
              targetBgSegments: { data: [{ segmentStart: 0, value: 6.1 }] },
              isfSegments: {
                data: [
                  { segmentStart: 0, value: 2.5 },
                  { segmentStart: 18, value: 2.0 },
                ],
              },
              insulinToCarbRatioSegments: {
                data: [{ segmentStart: 0, value: 10 }],
              },
            },
          ],
        },
      },
    },
  },
};

// --- Run the pipeline -----------------------------------------------------
const thresholds = getThresholds('mmol', 3.9, 10.0);
const timeline = processUnifiedGlookoData(data1);
const settingsHistory = getActiveSettings(
  data3,
  dayStart * 1000,
  (dayStart + 86400) * 1000
);

assert(timeline.length > 0, 'timeline built');
assert(
  timeline.filter((i) => i.type === 'CGM').length === 288,
  '288 unique 5-min CGM buckets'
);
assert(
  timeline.filter((i) => i.type === 'BOLUS').length === 3,
  '3 boluses carried through'
);
assert(
  timeline.some((b) => b.class === 'Meal Bolus') &&
    timeline.some((b) => b.class === 'Manual Correction Bolus') &&
    timeline.some((b) => b.class === 'System Correction Bolus'),
  'bolus categories assigned'
);

const hourly = calculateHourly(timeline, thresholds);
assert(hourly.length === 24, '24 hourly buckets');
const eveningHigh = hourly.filter((h) => h.hourNum >= 18 && h.hourNum < 22);
assert(
  eveningHigh.every((h) => h.high > 50),
  'evening hours show majority time-high (engineered pattern detected)'
);

const bolusLog = buildEnrichedBolusLog(timeline, settingsHistory);
assert(bolusLog.length === 3, 'enriched bolus log has 3 entries');
assert(
  bolusLog.every((b) => b.context && b.context.DIA === 2),
  'bolus context resolved DIA from settings'
);
assert(
  bolusLog.every((b) => b.cgm_val !== undefined),
  'bolus matched to interpolated BG'
);

const summary = computeSummary(
  timeline,
  data2,
  settingsHistory,
  thresholds,
  'mmol/L'
);
assert(summary.glucoseControl.cgmReadingCount === 288, 'summary CGM count');
assert(
  summary.glucoseControl.averageBG > 0 && summary.glucoseControl.gmiEstimatedA1c > 0,
  'summary computed avg BG and GMI'
);
assert(
  summary.insulin.bolusSource === 'archive-events' && summary.insulin.bolusUnits >= 0,
  'summary insulin reports bolus from events'
);
assert(
  summary.bestWorst.worstHour.hour !== 'N/A',
  'summary identified a worst hour'
);
assert(summary.settings.length === 1, 'summary surfaced settings snapshot');

console.log('\nSummary sample output:');
console.log(JSON.stringify(summary.glucoseControl, null, 2));
console.log('Worst hour:', JSON.stringify(summary.bestWorst.worstHour));
