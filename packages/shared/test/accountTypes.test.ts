/**
 * P8-4 account-type metadata + effective-value precedence — exhaustive,
 * mutation-grade. Every (synced type x override) combination is asserted
 * with exact expected values, the metadata map is locked field-by-field, the
 * legacy isLiabilityType() equivalence is pinned, and every dirty-data
 * failure path is proven to log through the shared logger and degrade
 * instead of throwing.
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_IDS,
  effectiveAccountType,
  effectiveIsLiability,
  isAccountTypeId,
  toAccountTypeId,
  toLegacyAccountType,
  type AccountTypeFields,
} from '../src/accountTypes.js';
import { createLogger, type LogLevel } from '../src/logger.js';
import { isLiabilityType, type AccountType, type AccountTypeId } from '../src/types/entities.js';

const ALL_TYPE_IDS: readonly AccountTypeId[] = [
  'checking',
  'savings',
  'credit-card',
  'investment',
  'business',
  'loan',
  'cash',
  'other',
];

const ALL_SYNCED_TYPES: readonly AccountType[] = [
  'checking',
  'savings',
  'credit',
  'investment',
  'loan',
  'other',
];

/** Captures every emitted line so failure-path logging is assertable. */
function captureLogger() {
  const lines: Array<{ level: LogLevel; line: string }> = [];
  const logger = createLogger({
    level: 'debug',
    sink: (level, line) => lines.push({ level, line }),
  });
  return { logger, lines };
}

describe('ACCOUNT_TYPES metadata map', () => {
  it('has exactly the eight locked type ids, in display order', () => {
    assert.deepEqual(ACCOUNT_TYPE_IDS, ALL_TYPE_IDS);
    assert.deepEqual(Object.keys(ACCOUNT_TYPES), ALL_TYPE_IDS);
  });

  it('carries the exact locked label, iconKey, and liability default per type', () => {
    assert.deepEqual(ACCOUNT_TYPES, {
      checking: { label: 'Checking', iconKey: 'bank', isLiabilityDefault: false },
      savings: { label: 'Savings', iconKey: 'piggy-bank', isLiabilityDefault: false },
      'credit-card': {
        label: 'Credit Card',
        iconKey: 'credit-card',
        isLiabilityDefault: true,
      },
      investment: {
        label: 'Investment',
        iconKey: 'chart-line-up',
        isLiabilityDefault: false,
      },
      business: { label: 'Business', iconKey: 'briefcase', isLiabilityDefault: false },
      loan: { label: 'Loan', iconKey: 'hand-coins', isLiabilityDefault: true },
      cash: { label: 'Cash', iconKey: 'money', isLiabilityDefault: false },
      other: { label: 'Other', iconKey: 'wallet', isLiabilityDefault: false },
    });
  });

  it('defaults to liability for exactly credit-card and loan', () => {
    const liabilityIds = ALL_TYPE_IDS.filter(
      (id) => ACCOUNT_TYPES[id].isLiabilityDefault,
    );
    assert.deepEqual(liabilityIds, ['credit-card', 'loan']);
  });

  it('agrees with the legacy isLiabilityType() for every synced type', () => {
    for (const synced of ALL_SYNCED_TYPES) {
      assert.equal(
        ACCOUNT_TYPES[toAccountTypeId(synced)].isLiabilityDefault,
        isLiabilityType(synced),
        `metadata default for synced '${synced}' must match isLiabilityType`,
      );
    }
  });
});

describe('isAccountTypeId', () => {
  it('accepts every id and nothing else', () => {
    for (const id of ALL_TYPE_IDS) {
      assert.equal(isAccountTypeId(id), true, id);
    }
    for (const bad of [
      'credit', // synced spelling, NOT a type id
      'Checking',
      'credit card',
      '',
      ' checking',
      'checking ',
      null,
      undefined,
      0,
      true,
      {},
      ['checking'],
      'toString', // Object.prototype member: must not leak through the lookup
      'constructor',
      '__proto__',
      'hasOwnProperty',
    ]) {
      assert.equal(isAccountTypeId(bad), false, String(bad));
    }
  });
});

describe('toAccountTypeId', () => {
  it('maps each synced type to its exact id (only credit is renamed)', () => {
    assert.equal(toAccountTypeId('checking'), 'checking');
    assert.equal(toAccountTypeId('savings'), 'savings');
    assert.equal(toAccountTypeId('credit'), 'credit-card');
    assert.equal(toAccountTypeId('investment'), 'investment');
    assert.equal(toAccountTypeId('loan'), 'loan');
    assert.equal(toAccountTypeId('other'), 'other');
  });

  it('degrades an unknown synced type to "other" and warns (never throws)', () => {
    const { logger, lines } = captureLogger();
    const dirty = 'brokerage' as AccountType;
    assert.equal(toAccountTypeId(dirty, logger), 'other');
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.level, 'warn');
    const record = JSON.parse(lines[0]?.line ?? '{}') as Record<string, unknown>;
    assert.equal(record['msg'], 'unknown synced accountType; falling back to "other"');
    assert.equal(record['accountType'], 'brokerage');
  });

  it('does not log on the happy path', () => {
    const { logger, lines } = captureLogger();
    for (const synced of ALL_SYNCED_TYPES) {
      toAccountTypeId(synced, logger);
    }
    assert.equal(lines.length, 0);
  });
});

describe('toLegacyAccountType', () => {
  it('maps every id to its exact legacy compatibility type', () => {
    assert.equal(toLegacyAccountType('checking'), 'checking');
    assert.equal(toLegacyAccountType('savings'), 'savings');
    assert.equal(toLegacyAccountType('credit-card'), 'credit');
    assert.equal(toLegacyAccountType('investment'), 'investment');
    assert.equal(toLegacyAccountType('business'), 'other');
    assert.equal(toLegacyAccountType('loan'), 'loan');
    assert.equal(toLegacyAccountType('cash'), 'other');
    assert.equal(toLegacyAccountType('other'), 'other');
  });

  it('round-trips synced -> id -> synced for every synced type', () => {
    for (const synced of ALL_SYNCED_TYPES) {
      assert.equal(toLegacyAccountType(toAccountTypeId(synced)), synced);
    }
  });
});

describe('effectiveAccountType — the sole precedence source', () => {
  it('returns the synced mapping when no override exists (all synced types)', () => {
    const expected: Record<AccountType, AccountTypeId> = {
      checking: 'checking',
      savings: 'savings',
      credit: 'credit-card',
      investment: 'investment',
      loan: 'loan',
      other: 'other',
    };
    const { logger, lines } = captureLogger();
    for (const synced of ALL_SYNCED_TYPES) {
      assert.equal(
        effectiveAccountType({ accountType: synced }, logger),
        expected[synced],
        synced,
      );
    }
    assert.equal(lines.length, 0);
  });

  it('override wins over EVERY synced type, for EVERY override id (48 pairs)', () => {
    const { logger, lines } = captureLogger();
    for (const synced of ALL_SYNCED_TYPES) {
      for (const override of ALL_TYPE_IDS) {
        assert.equal(
          effectiveAccountType({ accountType: synced, typeOverride: override }, logger),
          override,
          `${synced} + override ${override}`,
        );
      }
    }
    assert.equal(lines.length, 0);
  });

  it('ignores an invalid stored override, warns, and falls back to synced', () => {
    const { logger, lines } = captureLogger();
    const item = {
      accountType: 'credit',
      typeOverride: 'credit', // synced spelling is NOT a valid AccountTypeId
    } as unknown as AccountTypeFields;
    assert.equal(effectiveAccountType(item, logger), 'credit-card');
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.level, 'warn');
    const record = JSON.parse(lines[0]?.line ?? '{}') as Record<string, unknown>;
    assert.equal(record['msg'], 'ignoring invalid typeOverride on account item');
    assert.equal(record['typeOverride'], 'credit');
    assert.equal(record['accountType'], 'credit');
  });

  it('degrades doubly-dirty data (bad override AND unknown synced) to "other" with two warns', () => {
    const { logger, lines } = captureLogger();
    const item = {
      accountType: 'mystery',
      typeOverride: 'bogus',
    } as unknown as AccountTypeFields;
    assert.equal(effectiveAccountType(item, logger), 'other');
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.level, 'warn');
    assert.equal(lines[1]?.level, 'warn');
  });

  it('uses the shared module logger by default (failure path is never silent)', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const dirty = { accountType: 'mystery' } as unknown as AccountTypeFields;
      assert.equal(effectiveAccountType(dirty), 'other');
      assert.equal(warn.mock.callCount(), 1);
      const line = String(warn.mock.calls[0]?.arguments[0]);
      const record = JSON.parse(line) as Record<string, unknown>;
      assert.equal(record['level'], 'warn');
      assert.equal(record['service'], 'shared.accountTypes');
    } finally {
      warn.mock.restore();
    }
  });
});

describe('effectiveIsLiability — the sole precedence source', () => {
  it('with no overrides equals the metadata default of the synced type (and legacy isLiabilityType)', () => {
    const { logger, lines } = captureLogger();
    for (const synced of ALL_SYNCED_TYPES) {
      const expected = isLiabilityType(synced);
      assert.equal(
        effectiveIsLiability({ accountType: synced }, logger),
        expected,
        synced,
      );
    }
    // Pin the exact values too, not just the equivalence.
    assert.equal(effectiveIsLiability({ accountType: 'checking' }, logger), false);
    assert.equal(effectiveIsLiability({ accountType: 'savings' }, logger), false);
    assert.equal(effectiveIsLiability({ accountType: 'credit' }, logger), true);
    assert.equal(effectiveIsLiability({ accountType: 'investment' }, logger), false);
    assert.equal(effectiveIsLiability({ accountType: 'loan' }, logger), true);
    assert.equal(effectiveIsLiability({ accountType: 'other' }, logger), false);
    assert.equal(lines.length, 0);
  });

  it('a type override (no liability override) follows the NEW type default, for every pair', () => {
    const { logger, lines } = captureLogger();
    for (const synced of ALL_SYNCED_TYPES) {
      for (const override of ALL_TYPE_IDS) {
        assert.equal(
          effectiveIsLiability({ accountType: synced, typeOverride: override }, logger),
          ACCOUNT_TYPES[override].isLiabilityDefault,
          `${synced} + override ${override}`,
        );
      }
    }
    assert.equal(lines.length, 0);
  });

  it('switching an asset account to credit-card flips it to a liability (the P8-4 flip)', () => {
    assert.equal(
      effectiveIsLiability({ accountType: 'checking', typeOverride: 'credit-card' }),
      true,
    );
    assert.equal(
      effectiveIsLiability({ accountType: 'credit', typeOverride: 'checking' }),
      false,
    );
  });

  it('isLiabilityOverride wins over BOTH the synced type and any type override', () => {
    const { logger, lines } = captureLogger();
    for (const synced of ALL_SYNCED_TYPES) {
      for (const value of [true, false] as const) {
        assert.equal(
          effectiveIsLiability({ accountType: synced, isLiabilityOverride: value }, logger),
          value,
          `${synced} liability=${String(value)}`,
        );
        for (const override of ALL_TYPE_IDS) {
          assert.equal(
            effectiveIsLiability(
              { accountType: synced, typeOverride: override, isLiabilityOverride: value },
              logger,
            ),
            value,
            `${synced} + ${override} liability=${String(value)}`,
          );
        }
      }
    }
    assert.equal(lines.length, 0);
  });

  it('ignores a non-boolean stored override, warns, and uses the type default', () => {
    const { logger, lines } = captureLogger();
    const item = {
      accountType: 'credit',
      isLiabilityOverride: 'yes',
    } as unknown as AccountTypeFields;
    assert.equal(effectiveIsLiability(item, logger), true);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.level, 'warn');
    const record = JSON.parse(lines[0]?.line ?? '{}') as Record<string, unknown>;
    assert.equal(record['msg'], 'ignoring invalid isLiabilityOverride on account item');
    assert.equal(record['isLiabilityOverride'], 'yes');
    assert.equal(record['accountType'], 'credit');
  });

  it('treats null overrides as dirty data, not as false', () => {
    const { logger, lines } = captureLogger();
    const item = {
      accountType: 'loan',
      isLiabilityOverride: null,
    } as unknown as AccountTypeFields;
    // null must NOT read as an explicit false: type default still applies.
    assert.equal(effectiveIsLiability(item, logger), true);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.level, 'warn');
  });

  it('uses the shared module logger by default on the failure path', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const dirty = {
        accountType: 'checking',
        isLiabilityOverride: 1,
      } as unknown as AccountTypeFields;
      assert.equal(effectiveIsLiability(dirty), false);
      assert.equal(warn.mock.callCount(), 1);
      const record = JSON.parse(
        String(warn.mock.calls[0]?.arguments[0]),
      ) as Record<string, unknown>;
      assert.equal(record['service'], 'shared.accountTypes');
    } finally {
      warn.mock.restore();
    }
  });
});
