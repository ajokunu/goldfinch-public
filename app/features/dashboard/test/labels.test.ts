/**
 * Dashboard parameterized-label tests (lib/labels.ts; shell.md 8.3 pattern).
 * Expected strings are literals from the prototype KO table / design spec.
 *
 * setupDev must be the first import: the labels module pulls in
 * src/lib/logger.ts, which reads __DEV__ at initialization.
 */
import './setupDev';

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  headerDateLine,
  isoMonthName,
  monthSpendingTitle,
} from '../lib/labels';

describe('isoMonthName', () => {
  it('renders the English month name', () => {
    assert.equal(isoMonthName('2026-06', 'en-US'), 'June');
    assert.equal(isoMonthName('2026-01', 'en-US'), 'January');
    assert.equal(isoMonthName('2026-12', 'en-US'), 'December');
  });

  it('renders the Korean month name', () => {
    assert.equal(isoMonthName('2026-06', 'ko-KR'), '6월');
  });

  it('falls back to the raw value for unparsable months', () => {
    assert.equal(isoMonthName('junk' as never, 'en-US'), 'junk');
    assert.equal(isoMonthName('2026-' as never, 'en-US'), '2026-');
  });

  it('falls back to the raw value when Intl rejects the locale', () => {
    assert.equal(isoMonthName('2026-06', 'not a locale!!'), '2026-06');
  });

  it('does not mistake a parseable suffix for a year (slice-of-4 rule)', () => {
    // Number.parseInt('    ') is NaN, so this is the verbatim fallback;
    // parsing the WHOLE string would yield 6 and format a month name.
    assert.equal(isoMonthName('    6-06', 'en-US'), '    6-06');
  });

  it('logs the Intl fallback once, with dashboard context fields', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      assert.equal(isoMonthName('2026-06', 'not a locale!!'), '2026-06');
      assert.equal(warn.mock.callCount(), 1);
      const line = JSON.parse(String(warn.mock.calls[0]?.arguments[0]));
      assert.match(String(line.msg), /month-name formatting failed/);
      assert.equal(line.screen, 'dashboard');
      assert.equal(line.module, 'labels');
      assert.equal(line.month, '2026-06');
      assert.equal(line.locale, 'not a locale!!');
    } finally {
      warn.mock.restore();
    }
  });

  it('does NOT log for unparsable months (pure early return, no catch)', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      assert.equal(isoMonthName('junk' as never, 'en-US'), 'junk');
      assert.equal(isoMonthName('2026-' as never, 'en-US'), '2026-');
      assert.equal(warn.mock.callCount(), 0);
    } finally {
      warn.mock.restore();
    }
  });
});

describe('monthSpendingTitle', () => {
  it('matches the prototype EN and KO templates', () => {
    assert.equal(monthSpendingTitle('en', 'June'), 'June spending');
    assert.equal(monthSpendingTitle('ko', '6월'), '6월 지출');
  });
});

describe('headerDateLine', () => {
  const now = new Date(2026, 5, 10); // Wednesday, local time.

  it('formats weekday + month + day in the active locale', () => {
    assert.equal(headerDateLine('en-US', now), 'Wednesday, June 10');
    assert.equal(headerDateLine('ko-KR', now), '6월 10일 수요일');
  });

  it('falls back to the ISO date when Intl rejects the locale', () => {
    assert.equal(headerDateLine('not a locale!!', now), '2026-06-10');
    assert.equal(
      headerDateLine('not a locale!!', new Date(2026, 0, 5)),
      '2026-01-05',
    );
  });

  it('logs the Intl fallback once, with dashboard context fields', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      assert.equal(headerDateLine('not a locale!!', now), '2026-06-10');
      assert.equal(warn.mock.callCount(), 1);
      const line = JSON.parse(String(warn.mock.calls[0]?.arguments[0]));
      assert.match(String(line.msg), /header date-line formatting failed/);
      assert.equal(line.screen, 'dashboard');
      assert.equal(line.module, 'labels');
      assert.equal(line.locale, 'not a locale!!');
    } finally {
      warn.mock.restore();
    }
  });
});
