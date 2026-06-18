/**
 * Reports parameterized-label tests (lib/labels.ts; shell.md 8.3 pattern,
 * screens.md 4.2 honesty rule for the net-worth change pill). Expected
 * strings are literals from the design spec, never recomposed with the
 * helpers under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { netWorthChangeLabel, whereMonthWent } from '../lib/labels';

describe('whereMonthWent', () => {
  it('renders the English flow-card title', () => {
    assert.equal(whereMonthWent('en', 'June 2026'), 'Where June 2026 went');
  });

  it('renders the Korean flow-card title', () => {
    assert.equal(whereMonthWent('ko', '2026년 6월'), '2026년 6월 지출 내역');
  });
});

describe('netWorthChangeLabel', () => {
  it('renders the YTD form when a Jan-1 baseline exists', () => {
    assert.equal(
      netWorthChangeLabel('en', '+9.0%', 'ytd', ''),
      '+9.0% YTD',
    );
    assert.equal(
      netWorthChangeLabel('ko', '+9.0%', 'ytd', ''),
      '연초 대비 +9.0%',
    );
  });

  it('renders the since form with the baseline date label', () => {
    assert.equal(
      netWorthChangeLabel('en', '+4.2%', 'since', 'Mar 12'),
      '+4.2% since Mar 12',
    );
    assert.equal(
      netWorthChangeLabel('ko', '+4.2%', 'since', '3월 12일'),
      '3월 12일 이후 +4.2%',
    );
  });
});
