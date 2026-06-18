/**
 * Theme resolution unit tests (direction x mode x system), per
 * ops/DESIGN-INTEGRATION-DECISIONS.md item 6 and ops/design-spec/tokens.md.
 *
 * Every expected value below is a LITERAL transcribed from
 * design/prototype/themes.jsx / styles.css (via tokens.md) -- never computed
 * with the same helpers the source uses -- so StrykerJS mutants in the data
 * tables and resolvers cannot survive by symmetry.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_MODE,
  DIR_ORDER,
  isThemeDirection,
  isThemeModePreference,
  motion,
  resolveMode,
  resolvePalette,
  resolveTheme,
  type GFTheme,
  type ShadowToken,
  type ThemeDirection,
  type ThemeMode,
  type ThemeModePreference,
} from '../themeResolve';

const DIRECTIONS: readonly ThemeDirection[] = ['meridian', 'quant', 'studio', 'halo'];
const MODES: readonly ThemeMode[] = ['light', 'dark'];

// ---------------------------------------------------------------------------
// Expected literals (prototype parity tables)
// ---------------------------------------------------------------------------

type PaletteColors = Record<string, string>;

const EXPECTED_COLORS: Record<ThemeDirection, Record<ThemeMode, PaletteColors>> = {
  meridian: {
    light: {
      bg: '#F4F1E9', surface: '#FFFEFB', surfaceAlt: '#EDE7D9', elev: '#FFFFFF',
      border: '#E2DBCB', line: '#EAE3D4', text: '#1A2420', dim: '#6B7268',
      faint: '#9A9C8F', accent: '#1E4D3F', onAccent: '#F6F3EA', accent2: '#B07D2B',
      pos: '#1E7F4F', neg: '#B3463B', grid: '#E6DECD',
    },
    dark: {
      bg: '#0F1512', surface: '#17201B', surfaceAlt: '#1F2A24', elev: '#1D2823',
      border: '#2A3730', line: '#243029', text: '#ECF1ED', dim: '#94A199',
      faint: '#6A766E', accent: '#6BBE9F', onAccent: '#0F1512', accent2: '#D7A94E',
      pos: '#5FBF8B', neg: '#E2786B', grid: '#26332C',
    },
  },
  quant: {
    light: {
      bg: '#EEF1F0', surface: '#FFFFFF', surfaceAlt: '#E6EAE9', elev: '#FFFFFF',
      border: '#D6DCDB', line: '#E2E7E6', text: '#0E1413', dim: '#586461',
      faint: '#8C9794', accent: '#3F6E12', onAccent: '#FFFFFF', accent2: '#1265C8',
      pos: '#1B8A4B', neg: '#C8382E', grid: '#E0E5E4',
    },
    dark: {
      bg: '#0A0C0B', surface: '#111417', surfaceAlt: '#181D21', elev: '#161B1F',
      border: '#262C31', line: '#1E242A', text: '#E8ECEA', dim: '#8A9499',
      faint: '#5C666B', accent: '#C6F24E', onAccent: '#0A0C0B', accent2: '#54CFE6',
      pos: '#5FD08B', neg: '#FF6B6B', grid: '#1E252A',
    },
  },
  studio: {
    light: {
      bg: '#F5F2EA', surface: '#FFFFFF', surfaceAlt: '#ECE6D9', elev: '#FFFFFF',
      border: '#E3DCCC', line: '#EBE4D5', text: '#161208', dim: '#6A6456',
      faint: '#9C968A', accent: '#2438E0', onAccent: '#FFFFFF', accent2: '#FF5B38',
      pos: '#138A5B', neg: '#E23B2E', grid: '#E8E1D2',
    },
    dark: {
      bg: '#121110', surface: '#1C1915', surfaceAlt: '#262019', elev: '#211C16',
      border: '#332C22', line: '#2A241C', text: '#F5EFE4', dim: '#A49C8C',
      faint: '#726B5E', accent: '#6276FF', onAccent: '#0B0B14', accent2: '#FF7657',
      pos: '#3FBE82', neg: '#F0584A', grid: '#2A241C',
    },
  },
  halo: {
    light: {
      bg: '#F6F7FC', surface: '#FFFFFF', surfaceAlt: '#EEF1F9', elev: '#FFFFFF',
      border: '#E7EBF4', line: '#EFF2F9', text: '#171B2C', dim: '#6E7488',
      faint: '#A2A7B8', accent: '#5B5BF0', onAccent: '#FFFFFF', accent2: '#00B5A4',
      pos: '#14A37A', neg: '#F0526A', grid: '#EBEEF7',
    },
    dark: {
      bg: '#0B0D15', surface: '#151826', surfaceAlt: '#1C2030', elev: '#1A1E2D',
      // The 8-digit fully-transparent line is a verbatim source anomaly
      // (tokens.md 11.1) and MUST be carried as-is.
      border: '#272C40', line: '#20253600', text: '#ECEEF6', dim: '#8B91A6',
      faint: '#5E6478', accent: '#8484FF', onAccent: '#0B0D15', accent2: '#3ED4C4',
      pos: '#34C99A', neg: '#FF6A82', grid: '#1F2436',
    },
  },
};

const EXPECTED_CATS: Record<ThemeDirection, Record<string, string>> = {
  meridian: {
    c1: '#2E6E54', c2: '#B07D2B', c3: '#4E7A8A', c4: '#9A5E7A', c5: '#A65A3C',
    c6: '#6B7A45', c7: '#3E8A78', c8: '#8A6BA0', c9: '#5C6B8A', c0: '#2E7D55',
    other: '#8C8579',
  },
  quant: {
    c1: '#6FE39A', c2: '#FFC24E', c3: '#54CFE6', c4: '#C58CFF', c5: '#FF7A8A',
    c6: '#8FA0FF', c7: '#4ED6C0', c8: '#FF9FE0', c9: '#B8D24E', c0: '#5FD08B',
    other: '#8A9499',
  },
  studio: {
    c1: '#1FA85E', c2: '#F2A30A', c3: '#1466D6', c4: '#C0399E', c5: '#FF5B38',
    c6: '#6E56CF', c7: '#11A0A8', c8: '#E0356E', c9: '#4254E8', c0: '#1FA85E',
    other: '#8A8270',
  },
  halo: {
    c1: '#34C99A', c2: '#F5A65C', c3: '#5BA8F0', c4: '#9B6BF0', c5: '#F0708A',
    c6: '#6E78E8', c7: '#3CC9C0', c8: '#E58CD8', c9: '#7C7CF0', c0: '#14A37A',
    other: '#A2A7B8',
  },
};

/** Test-side ShadowToken constructor (independent of the source builder). */
function tok(
  web: string,
  shadowColor: string,
  height: number,
  shadowRadius: number,
  shadowOpacity: number,
  elevation: number,
): ShadowToken {
  return {
    ios: { shadowColor, shadowOffset: { width: 0, height }, shadowOpacity, shadowRadius },
    android: { elevation },
    web,
  };
}

const EXPECTED_SHADOWS: Record<
  ThemeDirection,
  Record<ThemeMode, { shadow: ShadowToken; shadowSm: ShadowToken }>
> = {
  meridian: {
    light: {
      shadow: tok('0 18px 44px -22px rgba(40,55,40,0.30)', '#283728', 18, 22, 0.3, 9),
      shadowSm: tok('0 4px 14px -8px rgba(40,55,40,0.25)', '#283728', 4, 7, 0.25, 2),
    },
    dark: {
      shadow: tok('0 22px 50px -22px rgba(0,0,0,0.66)', '#000000', 22, 25, 0.66, 11),
      shadowSm: tok('0 4px 16px -8px rgba(0,0,0,0.5)', '#000000', 4, 8, 0.5, 2),
    },
  },
  quant: {
    light: {
      shadow: tok('0 16px 36px -22px rgba(20,35,30,0.28)', '#14231E', 16, 18, 0.28, 8),
      shadowSm: tok('0 2px 10px -6px rgba(20,35,30,0.2)', '#14231E', 2, 5, 0.2, 1),
    },
    dark: {
      shadow: tok('0 18px 40px -24px rgba(0,0,0,0.8)', '#000000', 18, 20, 0.8, 9),
      shadowSm: tok('0 2px 10px -6px rgba(0,0,0,0.6)', '#000000', 2, 5, 0.6, 1),
    },
  },
  studio: {
    light: {
      shadow: tok('0 20px 44px -22px rgba(30,30,60,0.26)', '#1E1E3C', 20, 22, 0.26, 10),
      shadowSm: tok('0 4px 14px -8px rgba(30,30,60,0.2)', '#1E1E3C', 4, 7, 0.2, 2),
    },
    dark: {
      shadow: tok('0 22px 50px -22px rgba(0,0,0,0.7)', '#000000', 22, 25, 0.7, 11),
      shadowSm: tok('0 4px 16px -8px rgba(0,0,0,0.55)', '#000000', 4, 8, 0.55, 2),
    },
  },
  halo: {
    light: {
      shadow: tok('0 24px 50px -24px rgba(50,55,110,0.28)', '#32376E', 24, 25, 0.28, 12),
      shadowSm: tok('0 6px 18px -10px rgba(50,55,110,0.22)', '#32376E', 6, 9, 0.22, 3),
    },
    dark: {
      shadow: tok('0 26px 56px -24px rgba(0,0,0,0.66)', '#000000', 26, 28, 0.66, 13),
      shadowSm: tok('0 6px 20px -10px rgba(0,0,0,0.5)', '#000000', 6, 10, 0.5, 3),
    },
  },
};

const EXPECTED_META: Record<
  ThemeDirection,
  {
    name: string;
    tagline: string;
    radiusMd: number;
    radiusSm: number;
    densityName: 'cozy' | 'tight' | 'airy';
    pad: 14 | 18 | 22;
    chart: 'area' | 'grid' | 'block' | 'soft';
    hero: 'serif' | 'data' | 'editorial' | 'ring';
    progressBarHeight: 8 | 10;
    displayWeight: '500' | '600' | '700' | '800';
  }
> = {
  meridian: {
    name: 'Meridian',
    tagline: 'Calm · premium · editorial serif',
    radiusMd: 16, radiusSm: 11, densityName: 'cozy', pad: 18,
    chart: 'area', hero: 'serif', progressBarHeight: 8, displayWeight: '500',
  },
  quant: {
    name: 'Quant',
    tagline: 'Dense · pro · data-first',
    radiusMd: 8, radiusSm: 6, densityName: 'tight', pad: 14,
    chart: 'grid', hero: 'data', progressBarHeight: 8, displayWeight: '600',
  },
  studio: {
    name: 'Studio',
    tagline: 'Editorial · bold type · color blocks',
    radiusMd: 14, radiusSm: 9, densityName: 'cozy', pad: 18,
    chart: 'block', hero: 'editorial', progressBarHeight: 8, displayWeight: '800',
  },
  halo: {
    name: 'Halo',
    tagline: 'Soft · minimal · friendly fintech',
    radiusMd: 22, radiusSm: 15, densityName: 'airy', pad: 22,
    chart: 'soft', hero: 'ring', progressBarHeight: 10, displayWeight: '700',
  },
};

const EXPECTED_COMPONENTS: Record<ThemeDirection, GFTheme['components']> = {
  meridian: {
    screenTitle: { fontSize: 30, letterSpacing: -0.3 },
    card: { borderWidth: 1, shadow: 'sm' },
    cardTitle: { variant: 'display', fontSize: 16 },
    tokenRadius: 11, chipRadius: 999, segActive: 'surface', segRadius: 14,
    tabBarBlur: 20, fabRadius: 18, sheetRadius: 30,
  },
  quant: {
    screenTitle: { fontSize: 25, letterSpacing: -0.5 },
    card: { borderWidth: 1, shadow: 'none' },
    cardTitle: { variant: 'caps', color: 'dim' },
    tokenRadius: 6, chipRadius: 6, segActive: 'accent', segRadius: 9,
    tabBarBlur: 12, fabRadius: 10, sheetRadius: 14,
  },
  studio: {
    screenTitle: { fontSize: 33, letterSpacing: -0.825 },
    card: { borderWidth: 1.5, shadow: 'sm' },
    cardTitle: { variant: 'caps', color: 'text' },
    tokenRadius: 10, chipRadius: 8, segActive: 'surface', segRadius: 12,
    tabBarBlur: 20, fabRadius: 18, sheetRadius: 30,
  },
  halo: {
    screenTitle: { fontSize: 30, letterSpacing: -0.3 },
    card: { borderWidth: 1, shadow: 'sm' },
    cardTitle: { variant: 'caps', color: 'dim' },
    tokenRadius: 13, chipRadius: 999, segActive: 'surface', segRadius: 18,
    tabBarBlur: 20, fabRadius: 28, sheetRadius: 34,
  },
};

const NEWSREADER = {
  regular: 'Newsreader_500Medium',
  medium: 'Newsreader_500Medium',
  semibold: 'Newsreader_600SemiBold',
  bold: 'Newsreader_600SemiBold',
  extrabold: 'Newsreader_600SemiBold',
};
const HANKEN = {
  regular: 'HankenGrotesk_400Regular',
  medium: 'HankenGrotesk_500Medium',
  semibold: 'HankenGrotesk_600SemiBold',
  bold: 'HankenGrotesk_700Bold',
  extrabold: 'HankenGrotesk_700Bold',
};
const JETBRAINS = {
  regular: 'JetBrainsMono_400Regular',
  medium: 'JetBrainsMono_500Medium',
  semibold: 'JetBrainsMono_600SemiBold',
  bold: 'JetBrainsMono_700Bold',
  extrabold: 'JetBrainsMono_700Bold',
};
const SPACE = {
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
  extrabold: 'SpaceGrotesk_700Bold',
};
const SCHIBSTED = {
  regular: 'SchibstedGrotesk_500Medium',
  medium: 'SchibstedGrotesk_500Medium',
  semibold: 'SchibstedGrotesk_700Bold',
  bold: 'SchibstedGrotesk_700Bold',
  extrabold: 'SchibstedGrotesk_800ExtraBold',
};
const JAKARTA = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

const MONO_STACK = "'JetBrains Mono', monospace";
const HANKEN_STACK = "'Hanken Grotesk', system-ui, sans-serif";

const EXPECTED_FONTS: Record<ThemeDirection, GFTheme['fonts']> = {
  meridian: {
    display: 'Newsreader_500Medium',
    sans: 'HankenGrotesk_400Regular',
    mono: 'JetBrainsMono_400Regular',
    displayWeight: '500',
    displaySet: NEWSREADER, sansSet: HANKEN, monoSet: JETBRAINS,
    webStacks: {
      display: "'Newsreader', Georgia, serif",
      sans: HANKEN_STACK,
      mono: MONO_STACK,
    },
  },
  quant: {
    display: 'SpaceGrotesk_600SemiBold',
    sans: 'SpaceGrotesk_400Regular',
    mono: 'JetBrainsMono_400Regular',
    displayWeight: '600',
    displaySet: SPACE, sansSet: SPACE, monoSet: JETBRAINS,
    webStacks: {
      display: "'Space Grotesk', system-ui, sans-serif",
      sans: "'Space Grotesk', system-ui, sans-serif",
      mono: MONO_STACK,
    },
  },
  studio: {
    display: 'SchibstedGrotesk_800ExtraBold',
    sans: 'HankenGrotesk_400Regular',
    mono: 'JetBrainsMono_400Regular',
    displayWeight: '800',
    displaySet: SCHIBSTED, sansSet: HANKEN, monoSet: JETBRAINS,
    webStacks: {
      display: "'Schibsted Grotesk', system-ui, sans-serif",
      sans: HANKEN_STACK,
      mono: MONO_STACK,
    },
  },
  halo: {
    display: 'PlusJakartaSans_700Bold',
    sans: 'PlusJakartaSans_400Regular',
    mono: 'JetBrainsMono_400Regular',
    displayWeight: '700',
    displaySet: JAKARTA, sansSet: JAKARTA, monoSet: JETBRAINS,
    webStacks: {
      display: "'Plus Jakarta Sans', system-ui, sans-serif",
      sans: "'Plus Jakarta Sans', system-ui, sans-serif",
      mono: MONO_STACK,
    },
  },
};

// ---------------------------------------------------------------------------
// Order and defaults
// ---------------------------------------------------------------------------

describe('DIR_ORDER / DEFAULT_MODE', () => {
  it('keeps the prototype picker order', () => {
    assert.deepEqual([...DIR_ORDER], ['meridian', 'quant', 'studio', 'halo']);
  });

  it('keeps the prototype per-direction first-load mode hints', () => {
    assert.deepEqual(
      { ...DEFAULT_MODE },
      { meridian: 'light', quant: 'dark', studio: 'light', halo: 'light' },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveMode (preference x system scheme)
// ---------------------------------------------------------------------------

describe('resolveMode', () => {
  it('returns explicit preferences regardless of the system scheme', () => {
    assert.equal(resolveMode('light', 'dark'), 'light');
    assert.equal(resolveMode('light', null), 'light');
    assert.equal(resolveMode('dark', 'light'), 'dark');
    assert.equal(resolveMode('dark', undefined), 'dark');
  });

  it("follows the system scheme for 'system'", () => {
    assert.equal(resolveMode('system', 'light'), 'light');
    assert.equal(resolveMode('system', 'dark'), 'dark');
  });

  it("defaults 'system' to light when the scheme is unknown", () => {
    assert.equal(resolveMode('system', null), 'light');
    assert.equal(resolveMode('system', undefined), 'light');
  });
});

// ---------------------------------------------------------------------------
// resolvePalette: the cssVars() fallback chain t[mode] || t.light || t.dark
// ---------------------------------------------------------------------------

describe('resolvePalette', () => {
  it('picks the requested mode when present', () => {
    assert.equal(resolvePalette({ light: 'L', dark: 'D' }, 'light'), 'L');
    assert.equal(resolvePalette({ light: 'L', dark: 'D' }, 'dark'), 'D');
  });

  it('falls back to light when the requested mode is missing', () => {
    assert.equal(resolvePalette<string>({ light: 'L' }, 'dark'), 'L');
  });

  it('falls back to dark only when light is also missing', () => {
    assert.equal(resolvePalette<string>({ dark: 'D' }, 'light'), 'D');
  });

  it('prefers light over dark for an unknown mode', () => {
    assert.equal(
      resolvePalette({ light: 'L', dark: 'D' }, 'bogus' as ThemeMode),
      'L',
    );
  });

  it('returns undefined when no palette exists at all', () => {
    assert.equal(resolvePalette<string>({}, 'light'), undefined);
  });
});

// ---------------------------------------------------------------------------
// resolveTheme: prototype parity for every direction x mode
// ---------------------------------------------------------------------------

describe('resolveTheme palettes', () => {
  for (const direction of DIRECTIONS) {
    for (const mode of MODES) {
      it(`matches the prototype tokens for ${direction} ${mode}`, () => {
        const theme = resolveTheme(direction, mode);
        assert.equal(theme.direction, direction);
        assert.equal(theme.mode, mode);
        assert.equal(theme.scheme, mode);
        const expected = EXPECTED_COLORS[direction][mode];
        for (const [key, value] of Object.entries(expected)) {
          assert.equal(
            (theme.colors as unknown as PaletteColors)[key],
            value,
            `${direction}.${mode}.${key}`,
          );
        }
      });

      it(`derives the platform shadows for ${direction} ${mode}`, () => {
        const theme = resolveTheme(direction, mode);
        const expected = EXPECTED_SHADOWS[direction][mode];
        assert.deepEqual(theme.colors.shadow, expected.shadow);
        assert.deepEqual(theme.colors.shadowSm, expected.shadowSm);
        // The kit view exposes the same frozen objects.
        assert.equal(theme.shadows.lg, theme.colors.shadow);
        assert.equal(theme.shadows.sm, theme.colors.shadowSm);
      });

      it(`aliases legacy color names for ${direction} ${mode}`, () => {
        const { colors } = resolveTheme(direction, mode);
        assert.equal(colors.textPrimary, colors.text);
        assert.equal(colors.textSecondary, colors.dim);
        assert.equal(colors.textFaint, colors.faint);
        assert.equal(colors.danger, colors.neg);
        assert.equal(colors.positive, colors.pos);
        assert.equal(colors.tabBarBg, colors.surface);
        assert.equal(colors.tabActive, colors.accent);
        assert.equal(colors.tabInactive, colors.faint);
        assert.equal(colors.warning, mode === 'dark' ? '#E0A23C' : '#A36206');
        assert.equal(colors.scrim, 'rgba(8, 8, 10, 0.4)');
        assert.equal(colors.pushUnderlay, '#08080A');
      });
    }
  }
});

describe('resolveTheme category palettes', () => {
  for (const direction of DIRECTIONS) {
    it(`carries the ${direction} cats palette in both views`, () => {
      const theme = resolveTheme(direction, 'light');
      const expected = EXPECTED_CATS[direction];
      assert.deepEqual({ ...theme.cats }, expected);
      // Ordered chart series: c1..c9 then c0 (prototype CSS-var order).
      assert.deepEqual(
        [...theme.colors.categories],
        [
          expected['c1'], expected['c2'], expected['c3'], expected['c4'],
          expected['c5'], expected['c6'], expected['c7'], expected['c8'],
          expected['c9'], expected['c0'],
        ],
      );
      assert.equal(theme.colors.categoryOther, expected['other']);
      // Mode-independent: dark shares the identical palette values.
      assert.deepEqual({ ...resolveTheme(direction, 'dark').cats }, expected);
    });
  }
});

describe('resolveTheme metadata and structural tokens', () => {
  for (const direction of DIRECTIONS) {
    const meta = EXPECTED_META[direction];

    it(`exposes ${direction} direction metadata`, () => {
      const theme = resolveTheme(direction, 'light');
      assert.equal(theme.name, meta.name);
      assert.equal(theme.tagline, meta.tagline);
      assert.equal(theme.density.name, meta.densityName);
      assert.equal(theme.density.pad, meta.pad);
      assert.equal(theme.pad, meta.pad);
      assert.equal(theme.chart, meta.chart);
      assert.equal(theme.chartVariant, theme.chart);
      assert.equal(theme.hero, meta.hero);
      assert.equal(theme.progressBarHeight, meta.progressBarHeight);
      assert.equal(theme.fonts.displayWeight, meta.displayWeight);
    });

    it(`exposes the ${direction} radius scale in both views`, () => {
      const theme = resolveTheme(direction, 'light');
      const c = EXPECTED_COMPONENTS[direction];
      assert.deepEqual(
        { ...theme.radius },
        {
          sm: meta.radiusSm,
          md: meta.radiusMd,
          lg: meta.radiusMd,
          card: meta.radiusMd,
          control: meta.radiusSm,
          token: c.tokenRadius,
          chip: c.chipRadius,
          seg: c.segRadius,
          sheet: c.sheetRadius,
          fab: c.fabRadius,
        },
      );
    });

    it(`freezes the ${direction} styles.css data-dir variants`, () => {
      const theme = resolveTheme(direction, 'dark');
      assert.deepEqual(theme.components, EXPECTED_COMPONENTS[direction]);
      // Flattened kit view stays consistent with the spec view.
      assert.equal(theme.segmentedActive, theme.components.segActive);
      assert.equal(theme.card.borderWidth, theme.components.card.borderWidth);
      assert.equal(theme.card.shadow, theme.components.card.shadow);
      assert.equal(theme.card.titleVariant, theme.components.cardTitle.variant);
    });

    it(`resolves the ${direction} font cuts`, () => {
      const theme = resolveTheme(direction, 'light');
      assert.deepEqual(theme.fonts, EXPECTED_FONTS[direction]);
    });
  }

  it('maps card title color: display/studio use text, others dim', () => {
    assert.equal(resolveTheme('meridian', 'light').card.titleColor, 'text');
    assert.equal(resolveTheme('studio', 'light').card.titleColor, 'text');
    assert.equal(resolveTheme('quant', 'light').card.titleColor, 'dim');
    assert.equal(resolveTheme('halo', 'light').card.titleColor, 'dim');
  });

  it('seg radius is the frozen radius-sm + 3 per direction', () => {
    assert.equal(resolveTheme('meridian', 'light').radius.seg, 14);
    assert.equal(resolveTheme('quant', 'light').radius.seg, 9);
    assert.equal(resolveTheme('studio', 'light').radius.seg, 12);
    assert.equal(resolveTheme('halo', 'light').radius.seg, 18);
  });
});

describe('direction-independent tokens', () => {
  it('keeps the pre-redesign spacing and type scales on every theme', () => {
    for (const direction of DIRECTIONS) {
      const theme = resolveTheme(direction, 'light');
      assert.deepEqual(
        { ...theme.spacing },
        { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
      );
      assert.deepEqual(
        { ...theme.text },
        { title: 28, heading: 20, body: 16, caption: 13 },
      );
    }
  });

  it('shares the components.md motion tokens on every theme', () => {
    assert.deepEqual(motion, {
      press: { durationMs: 120, bezier: [0.25, 0.1, 0.25, 1] },
      control: { durationMs: 160, bezier: [0.25, 0.1, 0.25, 1] },
      select: { durationMs: 200, bezier: [0.25, 0.1, 0.25, 1] },
      toggleKnob: { durationMs: 220, bezier: [0.16, 1, 0.3, 1] },
      sheet: { durationMs: 460, bezier: [0.16, 1, 0.3, 1] },
      backdrop: { durationMs: 400, bezier: [0.25, 0.1, 0.25, 1] },
      push: { durationMs: 460, bezier: [0.32, 0.72, 0, 1] },
      countUp: { durationMs: 750, bezier: [0.33, 1, 0.68, 1] },
    });
    for (const direction of DIRECTIONS) {
      assert.equal(resolveTheme(direction, 'dark').motion, motion);
    }
  });
});

// ---------------------------------------------------------------------------
// Resolution composition (direction x mode x system) and runtime safety
// ---------------------------------------------------------------------------

describe('resolveTheme(resolveMode(...)) composition', () => {
  const cases: ReadonlyArray<
    [ThemeModePreference, ThemeMode | null | undefined, ThemeMode]
  > = [
    ['light', 'dark', 'light'],
    ['dark', 'light', 'dark'],
    ['system', 'light', 'light'],
    ['system', 'dark', 'dark'],
    ['system', null, 'light'],
    ['system', undefined, 'light'],
  ];

  for (const direction of DIRECTIONS) {
    for (const [preference, scheme, want] of cases) {
      it(`${direction} / ${preference} / system=${String(scheme)} -> ${want}`, () => {
        const theme = resolveTheme(direction, resolveMode(preference, scheme));
        assert.equal(theme.direction, direction);
        assert.equal(theme.mode, want);
        assert.equal(theme.colors.bg, EXPECTED_COLORS[direction][want]['bg']);
      });
    }
  }
});

describe('resolveTheme runtime safety', () => {
  it('returns cached frozen instances (stable identity)', () => {
    for (const direction of DIRECTIONS) {
      for (const mode of MODES) {
        assert.equal(resolveTheme(direction, mode), resolveTheme(direction, mode));
      }
    }
    assert.notEqual(resolveTheme('quant', 'light'), resolveTheme('quant', 'dark'));
    assert.notEqual(resolveTheme('quant', 'light'), resolveTheme('halo', 'light'));
  });

  it('falls back to meridian for a junk persisted direction', () => {
    const theme = resolveTheme('not-a-direction' as ThemeDirection, 'dark');
    assert.equal(theme.direction, 'meridian');
    assert.equal(theme.mode, 'dark');
  });

  it('falls back to the light palette for a junk mode (cssVars chain)', () => {
    const theme = resolveTheme('studio', 'no-preference' as ThemeMode);
    assert.equal(theme.mode, 'light');
    assert.equal(theme.colors.bg, EXPECTED_COLORS.studio.light['bg']);
  });

  it('deep-freezes every resolved theme', () => {
    for (const direction of DIRECTIONS) {
      for (const mode of MODES) {
        const theme = resolveTheme(direction, mode);
        assert.ok(Object.isFrozen(theme));
        assert.ok(Object.isFrozen(theme.colors));
        assert.ok(Object.isFrozen(theme.colors.categories));
        assert.ok(Object.isFrozen(theme.colors.shadow.ios.shadowOffset));
        assert.ok(Object.isFrozen(theme.cats));
        assert.ok(Object.isFrozen(theme.fonts.displaySet));
        assert.ok(Object.isFrozen(theme.radius));
        assert.ok(Object.isFrozen(theme.density));
        assert.ok(Object.isFrozen(theme.components.screenTitle));
        assert.ok(Object.isFrozen(theme.motion.press.bezier));
        assert.ok(Object.isFrozen(theme.card));
        assert.ok(Object.isFrozen(theme.shadows));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Persistence guards
// ---------------------------------------------------------------------------

describe('isThemeDirection / isThemeModePreference', () => {
  it('accepts exactly the four directions', () => {
    for (const direction of DIRECTIONS) {
      assert.ok(isThemeDirection(direction));
    }
    assert.ok(!isThemeDirection('Meridian'));
    assert.ok(!isThemeDirection('system'));
    assert.ok(!isThemeDirection(''));
    assert.ok(!isThemeDirection(undefined));
    assert.ok(!isThemeDirection(null));
    assert.ok(!isThemeDirection(42));
    assert.ok(!isThemeDirection(['meridian']));
  });

  it('accepts exactly the three mode preferences', () => {
    assert.ok(isThemeModePreference('light'));
    assert.ok(isThemeModePreference('dark'));
    assert.ok(isThemeModePreference('system'));
    assert.ok(!isThemeModePreference('auto'));
    assert.ok(!isThemeModePreference(''));
    assert.ok(!isThemeModePreference(undefined));
    assert.ok(!isThemeModePreference(null));
    assert.ok(!isThemeModePreference(true));
  });
});
