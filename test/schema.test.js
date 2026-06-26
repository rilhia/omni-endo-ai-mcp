/**
 * Tests the schema-version self-heal in initDb.
 *
 * An archive written by an older schema (user_version < current) has empty
 * tables for series added later. The top-up path keys off CGM recency and would
 * never backfill them, leaving days silently missing data. initDb must detect
 * the stale version, wipe the data, and re-stamp, so the next query cold-starts
 * a fresh, complete pull. A fresh DB must NOT be wiped.
 */

import { DatabaseSync } from 'node:sqlite';
import { initDb, getLatestCgmEpoch, closeDb } from '../src/store.js';
import { unlinkSync, existsSync } from 'fs';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok  :', msg);
  }
}

function cleanup(p) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      if (existsSync(p + suffix)) unlinkSync(p + suffix);
    } catch {
      /* ignore */
    }
  }
}

const STALE = '/tmp/omni-heal-stale.db';
const FRESH = '/tmp/omni-heal-fresh.db';
cleanup(STALE);
cleanup(FRESH);

// --- Case 1: a stale v1 archive with data gets wiped ---------------------
{
  const db = new DatabaseSync(STALE);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(
    `CREATE TABLE cgm(epoch INTEGER PRIMARY KEY, val REAL, vel REAL);
     CREATE TABLE bolus(epoch INTEGER PRIMARY KEY, units REAL, carbs REAL, iob REAL, class TEXT);
     CREATE TABLE settings(effective_epoch INTEGER PRIMARY KEY, effective_iso TEXT, json TEXT);
     CREATE TABLE daily_insulin(day_utc TEXT PRIMARY KEY, day_epoch INTEGER, basal_units REAL, bolus_units REAL, total_units REAL, complete INTEGER, ingested_at INTEGER);
     CREATE TABLE day_status(day_utc TEXT PRIMARY KEY, complete INTEGER, ingested_at INTEGER);`
  );
  db.exec('INSERT INTO cgm VALUES (1781913600, 6.5, 0.1)');
  db.exec('PRAGMA user_version = 1');
  db.close();
}

process.env.OMNI_DB_PATH = STALE;
initDb(STALE);
assert(
  getLatestCgmEpoch() === null,
  'stale v1 archive is wiped (no CGM rows remain), ready for cold-start'
);
{
  const check = new DatabaseSync(STALE);
  const v = Object.values(check.prepare('PRAGMA user_version').get())[0];
  assert(v === 5, `version re-stamped to current (got ${v})`);
  check.close();
}
closeDb();

// --- Case 2: a fresh DB is created at current version, not wiped ---------
process.env.OMNI_DB_PATH = FRESH;
initDb(FRESH);
{
  const check = new DatabaseSync(FRESH);
  const v = Object.values(check.prepare('PRAGMA user_version').get())[0];
  assert(v === 5, `fresh DB stamped at current version (got ${v})`);
  check.close();
}
closeDb();

cleanup(STALE);
cleanup(FRESH);
console.log('\nSchema self-heal test complete.');
