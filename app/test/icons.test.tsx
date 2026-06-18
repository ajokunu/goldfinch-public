/**
 * Identity icon system (ops/design-spec/icons.md): the category map covers
 * every live category id (ids are name slugs, so both ids and display names
 * must resolve), the slug keyword fallback handles user-created categories,
 * every mapped glyph is a real imported component (a missing per-icon import
 * would surface here as undefined), the 31 glyphs are pairwise distinct, the
 * account-type map is total, and both well components actually render a
 * phosphor duotone glyph under the real ThemeProvider.
 */
import { screen } from '@testing-library/react-native';
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_IDS,
} from '@goldfinch/shared/accountTypes';
import { GLYPH_KEYS } from '@goldfinch/shared/categoryStyle';

import {
  ACCOUNT_TYPE_ICON_GLYPHS,
  accountTypeGlyph,
  AccountTypeIcon,
  CATEGORY_ICONS,
  CategoryGlyph,
  CategoryIcon,
  DEFAULT_CATEGORY_ICON,
  GLYPH_MAP,
  resolveCategoryGlyph,
  resolveCategoryIcon,
  slugifyCategoryKey,
  UNCATEGORIZED_ICON,
} from '../src/ui/icons';
import { renderWithProviders } from './render';

/** The 32 live category display names (ids are these names slugified). */
const LIVE_CATEGORY_NAMES = [
  'Paycheck',
  'Other Income',
  'Retirement Contributions',
  'Groceries',
  'Dining & Drinks',
  'Coffee Shops',
  'Rent & Mortgage',
  'Utilities',
  'Internet & Phone',
  'Home & Supplies',
  'Gas & Fuel',
  'Auto & Transport',
  'Parking & Tolls',
  'Rideshare & Transit',
  'Shopping',
  'Clothing',
  'Electronics',
  'Subscriptions',
  'Entertainment',
  'Travel & Vacation',
  'Health & Medical',
  'Fitness',
  'Personal Care',
  'Insurance',
  'Fees & Charges',
  'Taxes',
  'Gifts & Donations',
  'Pets',
  'Education',
  'Credit Card Payment',
  'Transfers',
  'Miscellaneous',
] as const;


describe('category icon map', () => {
  it('covers every live category id with a real glyph component', () => {
    for (const name of LIVE_CATEGORY_NAMES) {
      const id = slugifyCategoryKey(name);
      const glyph = CATEGORY_ICONS[id];
      expect(glyph).toBeDefined();
      // A broken per-icon import would re-export undefined, not a component.
      expect(typeof glyph).toBe('function');
      expect(resolveCategoryIcon(id)).toBe(glyph);
      expect(resolveCategoryIcon(id)).not.toBe(DEFAULT_CATEGORY_ICON);
      expect(resolveCategoryIcon(id)).not.toBe(UNCATEGORIZED_ICON);
    }
  });

  it('maps exactly the 32 live categories, pairwise distinct', () => {
    const glyphs = Object.values(CATEGORY_ICONS);
    expect(glyphs).toHaveLength(32);
    expect(new Set(glyphs).size).toBe(32);
  });

  it('resolves display names identically to ids', () => {
    for (const name of LIVE_CATEGORY_NAMES) {
      expect(resolveCategoryIcon(name)).toBe(
        CATEGORY_ICONS[slugifyCategoryKey(name)],
      );
    }
  });

  it('keyword-falls-back for user-created categories', () => {
    expect(resolveCategoryIcon('crossfit-gym')).toBe(CATEGORY_ICONS['fitness']);
    expect(resolveCategoryIcon('date-night-dining')).toBe(
      CATEGORY_ICONS['dining-drinks'],
    );
    expect(resolveCategoryIcon('pet-supplies')).toBe(CATEGORY_ICONS['pets']);
    // Name-only resolution (second-chance argument).
    expect(resolveCategoryIcon(undefined, 'Weekend Coffee')).toBe(
      CATEGORY_ICONS['coffee-shops'],
    );
    // Transit keywords outrank the `tax` stem: taxi is never Taxes.
    expect(resolveCategoryIcon('taxi-rides')).toBe(
      CATEGORY_ICONS['rideshare-transit'],
    );
  });

  it('terminates at the default and uncategorized glyphs', () => {
    expect(resolveCategoryIcon('zzz-completely-unknown')).toBe(
      DEFAULT_CATEGORY_ICON,
    );
    expect(resolveCategoryIcon(null)).toBe(UNCATEGORIZED_ICON);
    expect(resolveCategoryIcon(undefined)).toBe(UNCATEGORIZED_ICON);
    expect(resolveCategoryIcon('')).toBe(UNCATEGORIZED_ICON);
    expect(resolveCategoryIcon('&&&')).toBe(UNCATEGORIZED_ICON);
    expect(DEFAULT_CATEGORY_ICON).not.toBe(UNCATEGORIZED_ICON);
  });
});

describe('account type icon map', () => {
  it('resolves a real component for every AccountTypeId (P8-4 full set)', () => {
    // ACCOUNT_TYPE_IDS comes from shared metadata: 8 ids incl business/loan/cash.
    expect(ACCOUNT_TYPE_IDS).toHaveLength(8);
    for (const typeId of ACCOUNT_TYPE_IDS) {
      const glyph = accountTypeGlyph(typeId);
      expect(typeof glyph).toBe('function');
      expect(glyph).toBe(ACCOUNT_TYPE_ICON_GLYPHS[ACCOUNT_TYPES[typeId].iconKey]);
    }
  });

  it('is total over the shared icon-key union with distinct glyphs', () => {
    const glyphs = Object.values(ACCOUNT_TYPE_ICON_GLYPHS);
    expect(glyphs).toHaveLength(8);
    expect(new Set(glyphs).size).toBe(8);
    for (const glyph of glyphs) {
      expect(typeof glyph).toBe('function');
    }
  });
});

describe('icon components', () => {
  it('CategoryIcon renders the duotone glyph inside the well', async () => {
    renderWithProviders(<CategoryIcon categoryId="groceries" />);
    // The well is decorative (accessibility-hidden); query past that.
    expect(
      await screen.findByTestId('phosphor-react-native-basket-duotone', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
  });

  it('CategoryGlyph renders bare and falls back by name', async () => {
    renderWithProviders(
      <CategoryGlyph categoryId="weekend-espresso" categoryName="Espresso Bar" />,
    );
    expect(
      await screen.findByTestId('phosphor-react-native-coffee-duotone'),
    ).toBeOnTheScreen();
  });

  it('AccountTypeIcon renders the mapped account glyph', async () => {
    renderWithProviders(<AccountTypeIcon accountTypeId="savings" />);
    // The well is decorative (accessibility-hidden); query past that.
    expect(
      await screen.findByTestId('phosphor-react-native-piggy-bank-duotone', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
  });

  it('AccountTypeIcon covers the override-only types (business/cash)', async () => {
    renderWithProviders(<AccountTypeIcon accountTypeId="business" />);
    expect(
      await screen.findByTestId('phosphor-react-native-briefcase-duotone', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
  });
});

describe('curated glyph map (P10-2 contract)', () => {
  it('is total over the shared GLYPH_KEYS with real components, no drift', () => {
    // The load-time assertion in glyphs.ts already throws on drift; pin it here
    // too so a regression surfaces as a readable test failure, not a crash.
    expect(Object.keys(GLYPH_MAP).sort()).toEqual([...GLYPH_KEYS].sort());
    for (const key of GLYPH_KEYS) {
      const meta = GLYPH_MAP[key];
      expect(typeof meta.glyph).toBe('function');
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveCategoryGlyph (P10-4 icon precedence)', () => {
  it('honors a valid iconKey over the keyword/slug fallback', () => {
    // groceries would auto-resolve to Basket; an explicit coffee key wins.
    expect(resolveCategoryGlyph('coffee', 'groceries', 'Groceries')).toBe(
      GLYPH_MAP['coffee'].glyph,
    );
  });

  it('falls back to the keyword/slug glyph when iconKey is absent', () => {
    expect(resolveCategoryGlyph(undefined, 'groceries', 'Groceries')).toBe(
      resolveCategoryIcon('groceries', 'Groceries'),
    );
    expect(resolveCategoryGlyph(null, 'crossfit-gym')).toBe(
      CATEGORY_ICONS['fitness'],
    );
  });

  it('ignores an unknown iconKey and uses the fallback (never blank)', () => {
    expect(resolveCategoryGlyph('not-a-real-key', 'groceries')).toBe(
      resolveCategoryIcon('groceries'),
    );
    // No id + no valid key terminates at the uncategorized glyph, not blank.
    expect(resolveCategoryGlyph('also-bad', null)).toBe(UNCATEGORIZED_ICON);
  });
});

describe('CategoryIcon / CategoryGlyph honor iconKey then fall back', () => {
  it('CategoryIcon renders the explicit iconKey glyph (wins over slug)', async () => {
    // categoryId "groceries" auto-resolves to basket; iconKey coffee overrides.
    renderWithProviders(
      <CategoryIcon categoryId="groceries" iconKey="coffee" />,
    );
    expect(
      await screen.findByTestId('phosphor-react-native-coffee-duotone', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
  });

  it('CategoryGlyph falls back to the slug glyph when iconKey is invalid', async () => {
    renderWithProviders(
      <CategoryGlyph categoryId="groceries" iconKey="totally-unknown" />,
    );
    expect(
      await screen.findByTestId('phosphor-react-native-basket-duotone'),
    ).toBeOnTheScreen();
  });
});
