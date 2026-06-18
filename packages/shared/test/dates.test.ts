/**
 * DEFAULT_TZ calendar-day bucketing tests, including both 2026 DST transitions
 * (EST -> EDT on 2026-03-08, EDT -> EST on 2026-11-01) and midnight-ET edges.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TZ } from '../src/constants.js';
import {
  DateError,
  epochSecondsToIsoDateInTz,
  isoDateInTz,
  weekdayInTz,
} from '../src/dates.js';
import { SimpleFinError, epochToIsoDate } from '../src/simplefin.js';

/** Epoch seconds for a UTC wall-clock instant. */
function utc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
}

describe('epochToIsoDate (DEFAULT_TZ America/New_York bucketing)', () => {
  it('keeps an 8pm-midnight ET posting on its ET day (the UTC-bucketing regression)', () => {
    // 2026-06-09T02:00:00Z is 2026-06-08 22:00 EDT: UTC bucketing would say
    // 2026-06-09 and the transaction would escape June 8 windows.
    assert.equal(epochToIsoDate(utc(2026, 6, 9, 2, 0, 0)), '2026-06-08');
  });

  it('buckets midnight ET exactly during EDT (UTC-4)', () => {
    assert.equal(epochToIsoDate(utc(2026, 6, 9, 3, 59, 59)), '2026-06-08');
    assert.equal(epochToIsoDate(utc(2026, 6, 9, 4, 0, 0)), '2026-06-09');
  });

  it('buckets midnight ET exactly during EST (UTC-5)', () => {
    assert.equal(epochToIsoDate(utc(2026, 1, 15, 4, 59, 59)), '2026-01-14');
    assert.equal(epochToIsoDate(utc(2026, 1, 15, 5, 0, 0)), '2026-01-15');
  });

  it('handles the spring-forward transition (2026-03-08, EST -> EDT)', () => {
    // Last instant of March 7 EST and first instant of March 8 EST.
    assert.equal(epochToIsoDate(utc(2026, 3, 8, 4, 59, 59)), '2026-03-07');
    assert.equal(epochToIsoDate(utc(2026, 3, 8, 5, 0, 0)), '2026-03-08');
    // 01:59:59 EST, then the clock jumps to 03:00 EDT — same calendar day.
    assert.equal(epochToIsoDate(utc(2026, 3, 8, 6, 59, 59)), '2026-03-08');
    assert.equal(epochToIsoDate(utc(2026, 3, 8, 7, 0, 0)), '2026-03-08');
    // First midnight after the transition is UTC-4, not UTC-5.
    assert.equal(epochToIsoDate(utc(2026, 3, 9, 3, 59, 59)), '2026-03-08');
    assert.equal(epochToIsoDate(utc(2026, 3, 9, 4, 0, 0)), '2026-03-09');
  });

  it('handles the fall-back transition (2026-11-01, EDT -> EST)', () => {
    // Last instant of October 31 EDT and first instant of November 1 EDT.
    assert.equal(epochToIsoDate(utc(2026, 11, 1, 3, 59, 59)), '2026-10-31');
    assert.equal(epochToIsoDate(utc(2026, 11, 1, 4, 0, 0)), '2026-11-01');
    // The repeated 1:00-1:59 hour: both the EDT and EST passes are Nov 1.
    assert.equal(epochToIsoDate(utc(2026, 11, 1, 5, 30, 0)), '2026-11-01');
    assert.equal(epochToIsoDate(utc(2026, 11, 1, 6, 30, 0)), '2026-11-01');
    // First midnight after the transition is UTC-5 again.
    assert.equal(epochToIsoDate(utc(2026, 11, 2, 4, 59, 59)), '2026-11-01');
    assert.equal(epochToIsoDate(utc(2026, 11, 2, 5, 0, 0)), '2026-11-02');
  });

  it('accepts an explicit tz override', () => {
    assert.equal(epochToIsoDate(utc(2026, 6, 9, 2, 0, 0), 'UTC'), '2026-06-09');
  });

  it('truncates fractional epoch seconds', () => {
    assert.equal(epochToIsoDate(utc(2026, 6, 9, 4, 0, 0) + 0.9), '2026-06-09');
  });

  it('rejects non-finite epochs', () => {
    assert.throws(() => epochToIsoDate(Number.NaN), SimpleFinError);
    assert.throws(() => epochToIsoDate(Number.POSITIVE_INFINITY), SimpleFinError);
  });
});

describe('isoDateInTz / epochSecondsToIsoDateInTz', () => {
  it('is pure: the same instant always yields the same DEFAULT_TZ day', () => {
    const epoch = utc(2026, 3, 8, 6, 59, 59);
    assert.equal(
      epochSecondsToIsoDateInTz(epoch),
      epochSecondsToIsoDateInTz(epoch, DEFAULT_TZ),
    );
    assert.equal(
      isoDateInTz(new Date(epoch * 1000), DEFAULT_TZ),
      epochSecondsToIsoDateInTz(epoch),
    );
  });

  it('rejects an invalid Date', () => {
    assert.throws(() => isoDateInTz(new Date(Number.NaN), DEFAULT_TZ), DateError);
  });

  it('rejects an invalid time zone', () => {
    assert.throws(() => isoDateInTz(new Date(0), 'Not/AZone'), DateError);
  });
});

describe('weekdayInTz (P11-2 — 0=Sunday .. 6=Saturday in tz)', () => {
  it('maps each weekday to its US index across a known week', () => {
    // 2026-06-07 (Sun) .. 2026-06-13 (Sat), sampled at noon EDT each day.
    const expected = [
      ['2026-06-07', 0],
      ['2026-06-08', 1],
      ['2026-06-09', 2],
      ['2026-06-10', 3],
      ['2026-06-11', 4],
      ['2026-06-12', 5],
      ['2026-06-13', 6],
    ] as const;
    for (const [iso, index] of expected) {
      const parts = iso.split('-');
      const noonEdt = new Date(
        utc(Number(parts[0]), Number(parts[1]), Number(parts[2]), 16, 0, 0) * 1000,
      );
      assert.equal(weekdayInTz(noonEdt, DEFAULT_TZ), index);
    }
  });

  it('attributes a near-midnight ET instant to its ET weekday, not the UTC one', () => {
    // 2026-06-14T02:00:00Z is 2026-06-13 22:00 EDT — still Saturday (6) in ET,
    // even though it is Sunday in UTC.
    assert.equal(weekdayInTz(new Date(utc(2026, 6, 14, 2, 0, 0) * 1000), DEFAULT_TZ), 6);
    assert.equal(weekdayInTz(new Date(utc(2026, 6, 14, 2, 0, 0) * 1000), 'UTC'), 0);
  });

  it('crosses the Saturday->Sunday boundary at ET midnight', () => {
    // Last instant of Saturday 2026-06-13 EDT, then first of Sunday 2026-06-14.
    assert.equal(weekdayInTz(new Date(utc(2026, 6, 14, 3, 59, 59) * 1000), DEFAULT_TZ), 6);
    assert.equal(weekdayInTz(new Date(utc(2026, 6, 14, 4, 0, 0) * 1000), DEFAULT_TZ), 0);
  });

  it('is correct on both 2026 DST Sundays', () => {
    assert.equal(weekdayInTz(new Date(utc(2026, 3, 8, 16, 0, 0) * 1000), DEFAULT_TZ), 0);
    assert.equal(weekdayInTz(new Date(utc(2026, 11, 1, 16, 0, 0) * 1000), DEFAULT_TZ), 0);
  });

  it('reuses the cached formatter on a repeated zone (cache-hit path)', () => {
    const a = weekdayInTz(new Date(utc(2026, 6, 10, 16, 0, 0) * 1000), DEFAULT_TZ);
    const b = weekdayInTz(new Date(utc(2026, 6, 10, 16, 0, 0) * 1000), DEFAULT_TZ);
    assert.equal(a, b);
    assert.equal(a, 3);
  });

  it('rejects an invalid Date with a typed DateError', () => {
    assert.throws(() => weekdayInTz(new Date(Number.NaN), DEFAULT_TZ), DateError);
    assert.throws(
      () => weekdayInTz(new Date(Number.NaN), DEFAULT_TZ),
      /cannot derive a weekday from an invalid Date/,
    );
  });

  it('rejects an invalid IANA time zone with a typed DateError naming the zone', () => {
    assert.throws(() => weekdayInTz(new Date(0), 'Not/AZone'), DateError);
    assert.throws(
      () => weekdayInTz(new Date(0), 'Not/AZone'),
      /invalid IANA time zone: "Not\/AZone"/,
    );
  });
});

describe('mutation hardening (P7-10)', () => {
  it('DateError carries its name for structured logging', () => {
    try {
      isoDateInTz(new Date(Number.NaN), DEFAULT_TZ);
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof DateError);
      assert.equal(error.name, 'DateError');
    }
  });

  it('invalid-Date rejection is the typed guard, not a downstream Intl error', () => {
    assert.throws(
      () => isoDateInTz(new Date(Number.NaN), DEFAULT_TZ),
      /cannot derive a calendar date from an invalid Date/,
    );
  });

  it('invalid time zones report the zone in the message', () => {
    assert.throws(() => isoDateInTz(new Date(0), 'Not/AZone'), /invalid IANA time zone: "Not\/AZone"/);
  });

  it('rejects non-finite epoch seconds with the typed epoch guard', () => {
    assert.throws(() => epochSecondsToIsoDateInTz(Number.NaN), /invalid epoch timestamp: NaN/);
    assert.throws(() => epochSecondsToIsoDateInTz(Number.POSITIVE_INFINITY), /invalid epoch timestamp: Infinity/);
    assert.throws(() => epochSecondsToIsoDateInTz(Number.NEGATIVE_INFINITY), DateError);
  });
});
