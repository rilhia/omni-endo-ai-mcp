/**
 * Tests extractDeviceEvents against the real 2026-06-20 Glooko response.
 *
 * That day's setSiteChange has the same pod-change event emitted TWICE with an
 * identical timestamp (2026-06-20T00:28:06Z); it must dedupe to a single event.
 * cgmSensorChange has one event (2026-06-20T00:17:23Z). The two types must stay
 * separate.
 */

import { extractDeviceEvents } from '../src/analytics.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
}

// Real shapes from the 2026-06-20 data (duplicated pod change, single sensor).
const rawJson = {
  series: {
    setSiteChange: [
      { x: 1781915286, timestamp: '2026-06-20T00:28:06.000Z' },
      { x: 1781915286, timestamp: '2026-06-20T00:28:06.000Z' }, // duplicate
    ],
    cgmSensorChange: [
      { x: 1781914643, timestamp: '2026-06-20T00:17:23.000Z', type: 'cgm_sensor_change' },
    ],
  },
};

const ev = extractDeviceEvents(rawJson);

assert(ev.podChanges.length === 1, `pod change dedupes 2 -> 1 (got ${ev.podChanges.length})`);
assert(
  ev.podChanges[0].time === '2026-06-20T00:28:06.000Z',
  'pod change timestamp preserved'
);
assert(ev.sensorChanges.length === 1, `one sensor change (got ${ev.sensorChanges.length})`);
assert(
  ev.sensorChanges[0].time === '2026-06-20T00:17:23.000Z',
  'sensor change timestamp preserved'
);

// Types stay separate: the pod epoch must not appear among sensor changes.
assert(
  !ev.sensorChanges.some((s) => s.epoch === ev.podChanges[0].epoch),
  'pod and sensor events are kept distinct'
);

// Empty / missing series degrade gracefully.
const empty = extractDeviceEvents({ series: {} });
assert(
  empty.podChanges.length === 0 && empty.sensorChanges.length === 0,
  'missing series yields empty lists, no throw'
);

// Three duplicates collapse to one too.
const triple = extractDeviceEvents({
  series: {
    setSiteChange: [
      { x: 1781915286, timestamp: '2026-06-20T00:28:06.000Z' },
      { x: 1781915286, timestamp: '2026-06-20T00:28:06.000Z' },
      { x: 1781915286, timestamp: '2026-06-20T00:28:06.000Z' },
    ],
  },
});
assert(triple.podChanges.length === 1, 'three identical pod changes dedupe to one');

console.log('\nDevice events test complete.');
