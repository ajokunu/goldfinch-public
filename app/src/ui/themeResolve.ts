/**
 * Theme engine: pure data + pure resolvers, zero imports.
 *
 * Source of truth: design/prototype/themes.jsx + styles.css, transcribed per
 * ops/design-spec/tokens.md (ops/DESIGN-INTEGRATION-DECISIONS.md is
 * authoritative). The per-direction { light, dark } palette structure mirrors
 * themes.jsx for diffable parity with the prototype.
 *
 * The resolved GFTheme is the UNION of the surfaces the parallel design
 * workstreams compile against:
 *
 * - tokens.md section 9: direction/mode/name/tagline, prototype color names
 *   (text/dim/faint/pos/neg/...), `cats`, FontCutSets, `pad`, `chart`,
 *   `hero`, `components.*`.
 * - components.md (component kit, already in app/src/ui): `colors.textPrimary
 *   / textSecondary / textFaint / categories / scrim / pushUnderlay`,
 *   `radius.card/control/token/chip/sheet/fab`, `density.pad`, `fonts.display
 *   / sans / mono` as loaded family strings, `motion`, `shadows.sm/lg`,
 *   `segmentedActive`, `card.{borderWidth,shadow,titleVariant}`.
 * - charts.md: `chartVariant` (alias of `chart`), `colors.categories`,
 *   `progressBarHeight` (halo 10, others 8).
 *
 * Where two specs name the same datum differently, both names are provided
 * and frozen to the same values; the unit tests assert cross-consistency so
 * the aliases cannot drift.
 *
 * Platform-neutral on purpose (no react-native / expo imports): exercised
 * directly by node --test in test/themeResolve.test.ts and targeted by
 * StrykerJS mutation testing (decisions item 6). All exported objects are
 * deep-frozen; resolveTheme() returns cached frozen instances, so referential
 * identity is stable across calls (safe for useMemo / React.memo consumers).
 */

export type ThemeDirection = 'meridian' | 'quant' | 'studio' | 'halo';
export type ThemeMode = 'light' | 'dark';
/** Exactly the persisted uiStore.themeOverride union. */
export type ThemeModePreference = ThemeMode | 'system';
export type ThemeDensity = 'cozy' | 'tight' | 'airy';
export type ChartTreatment = 'area' | 'grid' | 'block' | 'soft';
/** charts.md name for the same union. */
export type ChartVariant = ChartTreatment;
export type HeroTreatment = 'serif' | 'data' | 'editorial' | 'ring';

/**
 * One prototype box-shadow in all three platform forms, derived once per
 * tokens.md section 4.1 and frozen here -- no runtime parsing. Apply via
 * `shadowStyle()` from app/src/ui/shadows.ts.
 */
export interface ShadowToken {
  ios: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
  };
  android: { elevation: number };
  /** Exact prototype box-shadow string, applied verbatim on web. */
  web: string;
}

/**
 * Per-direction category palette (mode-independent, prototype `cats`):
 * category chips, donut/bar segments, budget rows. Keyed reads go through
 * `theme.cats`; the chart kit's ordered-series view lives at
 * `colors.categories` / `colors.categoryOther` (charts.md ChartThemeSource).
 */
export interface CategoryPalette {
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  c5: string;
  c6: string;
  c7: string;
  c8: string;
  c9: string;
  c0: string;
  other: string;
}

export interface ThemeColors {
  // Prototype tokens, 1:1 with themes.jsx palette keys (tokens.md section 2).
  bg: string;
  surface: string;
  surfaceAlt: string;
  /** Elevated surfaces (toasts) -- prototype `--elev`. */
  elev: string;
  border: string;
  /** Hairline separators, lighter than border -- prototype `--line`. */
  line: string;
  text: string;
  dim: string;
  faint: string;
  accent: string;
  onAccent: string;
  /** AI/suggestion + pending tint -- prototype `--accent2`. */
  accent2: string;
  pos: string;
  neg: string;
  /** Chart gridlines -- prototype `--grid`. */
  grid: string;
  /** Prototype `--shadow` (large). Also exposed as `theme.shadows.lg`. */
  shadow: ShadowToken;
  /** Prototype `--shadow-sm`. Also exposed as `theme.shadows.sm`. */
  shadowSm: ShadowToken;

  // Policy constants (components.md 7.3-7.4 / tokens.md 9.1).
  /** Sheet backdrop scrim; the same value in every direction and mode. */
  scrim: string;
  /** Opaque dark layer behind the pushed-back app frame. */
  pushUnderlay: string;
  /**
   * No prototype token (accent2 is cyan/teal in quant/halo, not a warning
   * color); keeps the pre-redesign per-mode constants.
   */
  warning: string;

  // Aliases consumed by the component kit and pre-redesign call sites.
  /** Alias of `text`. */
  textPrimary: string;
  /** Alias of `dim`. */
  textSecondary: string;
  /** Alias of `faint` (pending amounts, placeholders). */
  textFaint: string;
  /** Alias of `neg`. */
  danger: string;
  /** Alias of `pos`. */
  positive: string;
  /**
   * Opaque `surface` (the sanctioned no-blur tab bar fallback, tokens.md
   * 7.2). The prototype's translucent surface-at-88% + blur treatment is
   * recorded in `components.tabBarBlur` for the shell implementation.
   */
  tabBarBg: string;
  /** Alias of `accent`. */
  tabActive: string;
  /** Alias of `faint`. */
  tabInactive: string;
  /**
   * Ordered chart palette in prototype CSS-var order (c1..c9, c0) --
   * charts.md ChartThemeSource shape. Keyed reads: `theme.cats`.
   */
  categories: readonly string[];
  /** Catch-all "Other" slice color -- charts.md ChartThemeSource shape. */
  categoryOther: string;
}

/**
 * Loaded @expo-google-fonts family names, one per weight cut. RN (Android
 * especially) does not synthesize weights for custom fonts, so each weight is
 * a distinct fontFamily string -- never use numeric fontWeight with these.
 * Where a family lacks a loaded cut, the nearest loaded cut is substituted
 * (tokens.md section 8.3); CSS weight 650 maps to the semibold cut.
 */
export interface FontCutSet {
  /** 400 */
  regular: string;
  /** 500 */
  medium: string;
  /** 600 (also serves the prototype's CSS weight 650) */
  semibold: string;
  /** 700 */
  bold: string;
  /** 800 (nearest available cut where the family lacks 800) */
  extrabold: string;
}

export interface ThemeFonts {
  /**
   * Loaded display family at the direction's displayWeight cut -- what
   * hero/title text renders in. For other display weights use `displaySet`.
   */
  display: string;
  /** Loaded sans family, regular cut. Other weights: `sansSet`. */
  sans: string;
  /** Loaded mono family, regular cut (money/tabular numbers): `monoSet`. */
  mono: string;
  /**
   * Weight hero/title/display text uses (prototype --display-weight), as an
   * RN fontWeight string for the web/system fallback path. `display` above
   * already points at this cut; do not also set fontWeight with it on native.
   */
  displayWeight: '500' | '600' | '700' | '800';
  displaySet: FontCutSet;
  sansSet: FontCutSet;
  monoSet: FontCutSet;
  /** Web-only fallback stacks, appended after the loaded family on web. */
  webStacks: { display: string; sans: string; mono: string };
}

export interface ThemeRadius {
  /** Prototype `--radius-sm` (same as `control`). */
  sm: number;
  /** Prototype `--radius` (same as `card`). */
  md: number;
  /** @deprecated alias of `md`; pre-redesign call sites only. */
  lg: number;
  /** Card surfaces -- prototype `--radius` (meridian 16 / quant 8 / studio 14 / halo 22). */
  card: number;
  /** Controls, inputs, rows -- prototype `--radius-sm` (meridian 11 / quant 6 / studio 9 / halo 15). */
  control: number;
  /** Avatar token square (meridian 11 / quant 6 / studio 10 / halo 13). */
  token: number;
  /** Chips (pill 999 default / quant 6 / studio 8). */
  chip: number;
  /** Segmented-control container: radius-sm + 3, frozen per direction. */
  seg: number;
  /** Sheet top corners (30 default / quant 14 / halo 34). */
  sheet: number;
  /** FAB on a 56px box (18 default / quant 10 / halo 28 = circle). */
  fab: number;
}

/**
 * Motion token: duration + cubic-bezier control points (components.md
 * section 3). Consumers build the easing with
 * `Easing.bezier(...token.bezier)`; under reduced motion every duration
 * collapses to ~1ms (values jump to final state).
 */
export interface MotionToken {
  durationMs: number;
  bezier: readonly [number, number, number, number];
}

export interface MotionTokens {
  /** Row press, buttons (transform 120ms; background uses 150ms). */
  press: MotionToken;
  /** Chips, icon buttons. */
  control: MotionToken;
  /** Segmented control, toggle track. */
  select: MotionToken;
  /** Toggle knob travel. */
  toggleKnob: MotionToken;
  /** Sheet panel translate. */
  sheet: MotionToken;
  /** Sheet backdrop opacity. */
  backdrop: MotionToken;
  /** App-layer push-back behind a host sheet. */
  push: MotionToken;
  /** AnimatedCurrencyAmount count-up (ease-out cubic). */
  countUp: MotionToken;
}

/**
 * Frozen [data-dir] structural variants from styles.css (tokens.md section
 * 7.2). Components read these fields instead of branching on direction.
 * Radii here are duplicated into `theme.radius.*` for the component kit;
 * unit tests assert the two views never drift.
 */
export interface ComponentTokens {
  /** letterSpacing is already in px (RN), frozen at the title size. */
  screenTitle: { fontSize: number; letterSpacing: number };
  card: { borderWidth: number; shadow: 'sm' | 'none' };
  cardTitle:
    | { variant: 'caps'; color: 'dim' | 'text' }
    | { variant: 'display'; fontSize: 16 };
  /** Account/transaction avatar token radius. */
  tokenRadius: number;
  /** 999 = pill. */
  chipRadius: number;
  segActive: 'surface' | 'accent';
  /** Segmented-control container radius: radiusSm + 3, frozen. */
  segRadius: number;
  /** Backdrop blur intensity recorded for the tab bar implementation. */
  tabBarBlur: number;
  /** FAB is 56x56; halo's CSS 50% becomes 28. */
  fabRadius: number;
  /** Bottom-sheet top corner radius. */
  sheetRadius: number;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export interface ThemeTextScale {
  title: number;
  heading: number;
  body: number;
  caption: number;
}

export interface GFTheme {
  direction: ThemeDirection;
  mode: ThemeMode;
  /** Alias of `mode` for the component kit and pre-redesign call sites. */
  scheme: ThemeMode;
  /** Direction display name for the Settings picker (e.g. 'Meridian'). */
  name: string;
  /** Direction tagline for the Settings picker. */
  tagline: string;
  colors: ThemeColors;
  /** Keyed category palette (tokens.md section 9 name). */
  cats: CategoryPalette;
  fonts: ThemeFonts;
  radius: ThemeRadius;
  density: { name: ThemeDensity; pad: 14 | 18 | 22 };
  /** Horizontal screen gutter -- same value as `density.pad` (tokens.md 7.1). */
  pad: 14 | 18 | 22;
  chart: ChartTreatment;
  /** charts.md name; always equal to `chart`. */
  chartVariant: ChartVariant;
  hero: HeroTreatment;
  /** ProgBar height (charts.md section 8.1): halo 10, others 8. */
  progressBarHeight: 8 | 10;
  components: ComponentTokens;
  /** Pre-redesign spacing scale, retained for existing call sites. */
  spacing: ThemeSpacing;
  /** Pre-redesign type scale, retained for existing call sites. */
  text: ThemeTextScale;
  motion: MotionTokens;
  /** `sm` is `colors.shadowSm`, `lg` is `colors.shadow` (same objects). */
  shadows: { sm: ShadowToken; lg: ShadowToken };
  /** Segmented active treatment: raised surface (default) or accent fill (quant). */
  segmentedActive: 'surface' | 'accent';
  /** Card structural variants (flattened kit view of `components.card*`). */
  card: {
    borderWidth: number;
    shadow: 'sm' | 'none';
    titleVariant: 'display' | 'caps';
    /** Caps titles: dim by default, full-strength text in studio/meridian. */
    titleColor: 'dim' | 'text';
  };
}

/** Settings-picker order, exact prototype DIR_ORDER. */
export const DIR_ORDER: readonly ThemeDirection[] = Object.freeze([
  'meridian',
  'quant',
  'studio',
  'halo',
] as const);

/**
 * Prototype first-load mode hint per direction (NOT the app default; the app
 * defaults to direction 'meridian' + preference 'system'). May be shown as the
 * suggested mode when a user first picks a direction.
 */
export const DEFAULT_MODE: Readonly<Record<ThemeDirection, ThemeMode>> =
  Object.freeze({
    meridian: 'light',
    quant: 'dark',
    studio: 'light',
    halo: 'light',
  } as const);

// ---------------------------------------------------------------------------
// Internal helpers and constants
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Derived per tokens.md 4.1: offset.height = Y, radius = blur / 2, etc. */
function shadowToken(
  web: string,
  shadowColor: string,
  height: number,
  shadowRadius: number,
  shadowOpacity: number,
  elevation: number,
): ShadowToken {
  return {
    ios: {
      shadowColor,
      shadowOffset: { width: 0, height },
      shadowOpacity,
      shadowRadius,
    },
    android: { elevation },
    web,
  };
}

/** Scheme-agnostic scrim/underlay (components.md 7.3-7.4 policy). */
const SCRIM = 'rgba(8, 8, 10, 0.4)';
const PUSH_UNDERLAY = '#08080A';

/** Pre-redesign warning color (kept per tokens.md 9.1; no prototype token). */
const LEGACY_WARNING: Readonly<Record<ThemeMode, string>> = Object.freeze({
  light: '#A36206',
  dark: '#E0A23C',
});

/** Pre-redesign scales retained on GFTheme for existing call sites. */
const LEGACY_SPACING: ThemeSpacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
const LEGACY_TEXT_SCALE: ThemeTextScale = {
  title: 28,
  heading: 20,
  body: 16,
  caption: 13,
};

/** --pad per density; cozy is the :root default (tokens.md 7.1). */
const PAD_BY_DENSITY: Readonly<Record<ThemeDensity, 14 | 18 | 22>> =
  Object.freeze({ cozy: 18, tight: 14, airy: 22 });

// Motion tokens (components.md section 3); direction-independent.

/** CSS `ease` control points. */
const EASE = [0.25, 0.1, 0.25, 1] as const;
/** Prototype sheet/knob curve cubic-bezier(.16,1,.3,1). */
const SHEET_BEZIER = [0.16, 1, 0.3, 1] as const;
/** Prototype push curve cubic-bezier(.32,.72,0,1). */
const PUSH_BEZIER = [0.32, 0.72, 0, 1] as const;
/** Ease-out-cubic approximation as a bezier. */
const EASE_OUT_CUBIC = [0.33, 1, 0.68, 1] as const;

export const motion: MotionTokens = deepFreeze({
  press: { durationMs: 120, bezier: EASE },
  control: { durationMs: 160, bezier: EASE },
  select: { durationMs: 200, bezier: EASE },
  toggleKnob: { durationMs: 220, bezier: SHEET_BEZIER },
  sheet: { durationMs: 460, bezier: SHEET_BEZIER },
  backdrop: { durationMs: 400, bezier: EASE },
  push: { durationMs: 460, bezier: PUSH_BEZIER },
  countUp: { durationMs: 750, bezier: EASE_OUT_CUBIC },
});

// Font cut sets (tokens.md 8.3). Loaded cuts only (see app/src/ui/fonts.ts);
// nearest-cut substitution where a slot has no loaded weight.

/** Display-only family; only the 500/600 cuts the prototype uses are loaded. */
const NEWSREADER: FontCutSet = {
  regular: 'Newsreader_500Medium',
  medium: 'Newsreader_500Medium',
  semibold: 'Newsreader_600SemiBold',
  bold: 'Newsreader_600SemiBold',
  extrabold: 'Newsreader_600SemiBold',
};

const HANKEN_GROTESK: FontCutSet = {
  regular: 'HankenGrotesk_400Regular',
  medium: 'HankenGrotesk_500Medium',
  semibold: 'HankenGrotesk_600SemiBold',
  bold: 'HankenGrotesk_700Bold',
  extrabold: 'HankenGrotesk_700Bold',
};

const JETBRAINS_MONO: FontCutSet = {
  regular: 'JetBrainsMono_400Regular',
  medium: 'JetBrainsMono_500Medium',
  semibold: 'JetBrainsMono_600SemiBold',
  bold: 'JetBrainsMono_700Bold',
  extrabold: 'JetBrainsMono_700Bold',
};

/** Family ships no 800; quant never asks for one (max used is 700). */
const SPACE_GROTESK: FontCutSet = {
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
  extrabold: 'SpaceGrotesk_700Bold',
};

/** Display-only family; studio uses it at 800 (titles) and 500/700 accents. */
const SCHIBSTED_GROTESK: FontCutSet = {
  regular: 'SchibstedGrotesk_500Medium',
  medium: 'SchibstedGrotesk_500Medium',
  semibold: 'SchibstedGrotesk_700Bold',
  bold: 'SchibstedGrotesk_700Bold',
  extrabold: 'SchibstedGrotesk_800ExtraBold',
};

const PLUS_JAKARTA_SANS: FontCutSet = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

const JETBRAINS_MONO_WEB_STACK = "'JetBrains Mono', monospace";
const HANKEN_WEB_STACK = "'Hanken Grotesk', system-ui, sans-serif";

/** Prototype CSS-var order (--cat-c1 ... --cat-c9, --cat-c0). */
function categorySeries(cats: CategoryPalette): readonly string[] {
  return [
    cats.c1,
    cats.c2,
    cats.c3,
    cats.c4,
    cats.c5,
    cats.c6,
    cats.c7,
    cats.c8,
    cats.c9,
    cats.c0,
  ];
}

const CUT_BY_DISPLAY_WEIGHT: Readonly<
  Record<ThemeFonts['displayWeight'], keyof FontCutSet>
> = Object.freeze({
  '500': 'medium',
  '600': 'semibold',
  '700': 'bold',
  '800': 'extrabold',
});

/** Pure assembly so `display` always points at the displayWeight cut. */
function themeFonts(
  displaySet: FontCutSet,
  sansSet: FontCutSet,
  monoSet: FontCutSet,
  displayWeight: ThemeFonts['displayWeight'],
  webStacks: ThemeFonts['webStacks'],
): ThemeFonts {
  return {
    display: displaySet[CUT_BY_DISPLAY_WEIGHT[displayWeight]],
    sans: sansSet.regular,
    mono: monoSet.regular,
    displayWeight,
    displaySet,
    sansSet,
    monoSet,
    webStacks,
  };
}

// ---------------------------------------------------------------------------
// Direction definitions (mirrors themes.jsx structure; exact source values)
// ---------------------------------------------------------------------------

interface ModePalette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  elev: string;
  border: string;
  line: string;
  text: string;
  dim: string;
  faint: string;
  accent: string;
  onAccent: string;
  accent2: string;
  pos: string;
  neg: string;
  grid: string;
  shadow: ShadowToken;
  shadowSm: ShadowToken;
}

interface DirectionDefinition {
  name: string;
  tagline: string;
  fonts: ThemeFonts;
  radius: number;
  radiusSm: number;
  density: ThemeDensity;
  chart: ChartTreatment;
  hero: HeroTreatment;
  progressBarHeight: 8 | 10;
  cats: CategoryPalette;
  components: ComponentTokens;
  palettes: { light: ModePalette; dark: ModePalette };
}

const DEFINITIONS: Readonly<Record<ThemeDirection, DirectionDefinition>> =
  deepFreeze({
    meridian: {
      name: 'Meridian',
      tagline: 'Calm · premium · editorial serif',
      fonts: themeFonts(NEWSREADER, HANKEN_GROTESK, JETBRAINS_MONO, '500', {
        display: "'Newsreader', Georgia, serif",
        sans: HANKEN_WEB_STACK,
        mono: JETBRAINS_MONO_WEB_STACK,
      }),
      radius: 16,
      radiusSm: 11,
      density: 'cozy',
      chart: 'area',
      hero: 'serif',
      progressBarHeight: 8,
      cats: {
        c1: '#2E6E54',
        c2: '#B07D2B',
        c3: '#4E7A8A',
        c4: '#9A5E7A',
        c5: '#A65A3C',
        c6: '#6B7A45',
        c7: '#3E8A78',
        c8: '#8A6BA0',
        c9: '#5C6B8A',
        c0: '#2E7D55',
        other: '#8C8579',
      },
      components: {
        screenTitle: { fontSize: 30, letterSpacing: -0.3 },
        card: { borderWidth: 1, shadow: 'sm' },
        cardTitle: { variant: 'display', fontSize: 16 },
        tokenRadius: 11,
        chipRadius: 999,
        segActive: 'surface',
        segRadius: 14,
        tabBarBlur: 20,
        fabRadius: 18,
        sheetRadius: 30,
      },
      palettes: {
        light: {
          bg: '#F4F1E9',
          surface: '#FFFEFB',
          surfaceAlt: '#EDE7D9',
          elev: '#FFFFFF',
          border: '#E2DBCB',
          line: '#EAE3D4',
          text: '#1A2420',
          dim: '#6B7268',
          faint: '#9A9C8F',
          accent: '#1E4D3F',
          onAccent: '#F6F3EA',
          accent2: '#B07D2B',
          pos: '#1E7F4F',
          neg: '#B3463B',
          grid: '#E6DECD',
          shadow: shadowToken(
            '0 18px 44px -22px rgba(40,55,40,0.30)',
            '#283728',
            18,
            22,
            0.3,
            9,
          ),
          shadowSm: shadowToken(
            '0 4px 14px -8px rgba(40,55,40,0.25)',
            '#283728',
            4,
            7,
            0.25,
            2,
          ),
        },
        dark: {
          bg: '#0F1512',
          surface: '#17201B',
          surfaceAlt: '#1F2A24',
          elev: '#1D2823',
          border: '#2A3730',
          line: '#243029',
          text: '#ECF1ED',
          dim: '#94A199',
          faint: '#6A766E',
          accent: '#6BBE9F',
          onAccent: '#0F1512',
          accent2: '#D7A94E',
          pos: '#5FBF8B',
          neg: '#E2786B',
          grid: '#26332C',
          shadow: shadowToken(
            '0 22px 50px -22px rgba(0,0,0,0.66)',
            '#000000',
            22,
            25,
            0.66,
            11,
          ),
          shadowSm: shadowToken(
            '0 4px 16px -8px rgba(0,0,0,0.5)',
            '#000000',
            4,
            8,
            0.5,
            2,
          ),
        },
      },
    },

    quant: {
      name: 'Quant',
      tagline: 'Dense · pro · data-first',
      fonts: themeFonts(SPACE_GROTESK, SPACE_GROTESK, JETBRAINS_MONO, '600', {
        display: "'Space Grotesk', system-ui, sans-serif",
        sans: "'Space Grotesk', system-ui, sans-serif",
        mono: JETBRAINS_MONO_WEB_STACK,
      }),
      radius: 8,
      radiusSm: 6,
      density: 'tight',
      chart: 'grid',
      hero: 'data',
      progressBarHeight: 8,
      cats: {
        c1: '#6FE39A',
        c2: '#FFC24E',
        c3: '#54CFE6',
        c4: '#C58CFF',
        c5: '#FF7A8A',
        c6: '#8FA0FF',
        c7: '#4ED6C0',
        c8: '#FF9FE0',
        c9: '#B8D24E',
        c0: '#5FD08B',
        other: '#8A9499',
      },
      components: {
        screenTitle: { fontSize: 25, letterSpacing: -0.5 },
        card: { borderWidth: 1, shadow: 'none' },
        cardTitle: { variant: 'caps', color: 'dim' },
        tokenRadius: 6,
        chipRadius: 6,
        segActive: 'accent',
        segRadius: 9,
        tabBarBlur: 12,
        fabRadius: 10,
        sheetRadius: 14,
      },
      palettes: {
        light: {
          bg: '#EEF1F0',
          surface: '#FFFFFF',
          surfaceAlt: '#E6EAE9',
          elev: '#FFFFFF',
          border: '#D6DCDB',
          line: '#E2E7E6',
          text: '#0E1413',
          dim: '#586461',
          faint: '#8C9794',
          accent: '#3F6E12',
          onAccent: '#FFFFFF',
          accent2: '#1265C8',
          pos: '#1B8A4B',
          neg: '#C8382E',
          grid: '#E0E5E4',
          shadow: shadowToken(
            '0 16px 36px -22px rgba(20,35,30,0.28)',
            '#14231E',
            16,
            18,
            0.28,
            8,
          ),
          shadowSm: shadowToken(
            '0 2px 10px -6px rgba(20,35,30,0.2)',
            '#14231E',
            2,
            5,
            0.2,
            1,
          ),
        },
        dark: {
          bg: '#0A0C0B',
          surface: '#111417',
          surfaceAlt: '#181D21',
          elev: '#161B1F',
          border: '#262C31',
          line: '#1E242A',
          text: '#E8ECEA',
          dim: '#8A9499',
          faint: '#5C666B',
          accent: '#C6F24E',
          onAccent: '#0A0C0B',
          accent2: '#54CFE6',
          pos: '#5FD08B',
          neg: '#FF6B6B',
          grid: '#1E252A',
          shadow: shadowToken(
            '0 18px 40px -24px rgba(0,0,0,0.8)',
            '#000000',
            18,
            20,
            0.8,
            9,
          ),
          shadowSm: shadowToken(
            '0 2px 10px -6px rgba(0,0,0,0.6)',
            '#000000',
            2,
            5,
            0.6,
            1,
          ),
        },
      },
    },

    studio: {
      name: 'Studio',
      tagline: 'Editorial · bold type · color blocks',
      fonts: themeFonts(
        SCHIBSTED_GROTESK,
        HANKEN_GROTESK,
        JETBRAINS_MONO,
        '800',
        {
          display: "'Schibsted Grotesk', system-ui, sans-serif",
          sans: HANKEN_WEB_STACK,
          mono: JETBRAINS_MONO_WEB_STACK,
        },
      ),
      radius: 14,
      radiusSm: 9,
      density: 'cozy',
      chart: 'block',
      hero: 'editorial',
      progressBarHeight: 8,
      cats: {
        c1: '#1FA85E',
        c2: '#F2A30A',
        c3: '#1466D6',
        c4: '#C0399E',
        c5: '#FF5B38',
        c6: '#6E56CF',
        c7: '#11A0A8',
        c8: '#E0356E',
        c9: '#4254E8',
        c0: '#1FA85E',
        other: '#8A8270',
      },
      components: {
        screenTitle: { fontSize: 33, letterSpacing: -0.825 },
        card: { borderWidth: 1.5, shadow: 'sm' },
        cardTitle: { variant: 'caps', color: 'text' },
        tokenRadius: 10,
        chipRadius: 8,
        segActive: 'surface',
        segRadius: 12,
        tabBarBlur: 20,
        fabRadius: 18,
        sheetRadius: 30,
      },
      palettes: {
        light: {
          bg: '#F5F2EA',
          surface: '#FFFFFF',
          surfaceAlt: '#ECE6D9',
          elev: '#FFFFFF',
          border: '#E3DCCC',
          line: '#EBE4D5',
          text: '#161208',
          dim: '#6A6456',
          faint: '#9C968A',
          accent: '#2438E0',
          onAccent: '#FFFFFF',
          accent2: '#FF5B38',
          pos: '#138A5B',
          neg: '#E23B2E',
          grid: '#E8E1D2',
          shadow: shadowToken(
            '0 20px 44px -22px rgba(30,30,60,0.26)',
            '#1E1E3C',
            20,
            22,
            0.26,
            10,
          ),
          shadowSm: shadowToken(
            '0 4px 14px -8px rgba(30,30,60,0.2)',
            '#1E1E3C',
            4,
            7,
            0.2,
            2,
          ),
        },
        dark: {
          bg: '#121110',
          surface: '#1C1915',
          surfaceAlt: '#262019',
          elev: '#211C16',
          border: '#332C22',
          // line === grid (#2A241C) is intentional in the source.
          line: '#2A241C',
          text: '#F5EFE4',
          dim: '#A49C8C',
          faint: '#726B5E',
          accent: '#6276FF',
          onAccent: '#0B0B14',
          accent2: '#FF7657',
          pos: '#3FBE82',
          neg: '#F0584A',
          grid: '#2A241C',
          shadow: shadowToken(
            '0 22px 50px -22px rgba(0,0,0,0.7)',
            '#000000',
            22,
            25,
            0.7,
            11,
          ),
          shadowSm: shadowToken(
            '0 4px 16px -8px rgba(0,0,0,0.55)',
            '#000000',
            4,
            8,
            0.55,
            2,
          ),
        },
      },
    },

    halo: {
      name: 'Halo',
      tagline: 'Soft · minimal · friendly fintech',
      fonts: themeFonts(
        PLUS_JAKARTA_SANS,
        PLUS_JAKARTA_SANS,
        JETBRAINS_MONO,
        '700',
        {
          display: "'Plus Jakarta Sans', system-ui, sans-serif",
          sans: "'Plus Jakarta Sans', system-ui, sans-serif",
          mono: JETBRAINS_MONO_WEB_STACK,
        },
      ),
      radius: 22,
      radiusSm: 15,
      density: 'airy',
      chart: 'soft',
      hero: 'ring',
      progressBarHeight: 10,
      cats: {
        c1: '#34C99A',
        c2: '#F5A65C',
        c3: '#5BA8F0',
        c4: '#9B6BF0',
        c5: '#F0708A',
        c6: '#6E78E8',
        c7: '#3CC9C0',
        c8: '#E58CD8',
        c9: '#7C7CF0',
        c0: '#14A37A',
        other: '#A2A7B8',
      },
      components: {
        screenTitle: { fontSize: 30, letterSpacing: -0.3 },
        card: { borderWidth: 1, shadow: 'sm' },
        cardTitle: { variant: 'caps', color: 'dim' },
        tokenRadius: 13,
        chipRadius: 999,
        segActive: 'surface',
        segRadius: 18,
        tabBarBlur: 20,
        fabRadius: 28,
        sheetRadius: 34,
      },
      palettes: {
        light: {
          bg: '#F6F7FC',
          surface: '#FFFFFF',
          surfaceAlt: '#EEF1F9',
          elev: '#FFFFFF',
          border: '#E7EBF4',
          line: '#EFF2F9',
          text: '#171B2C',
          dim: '#6E7488',
          faint: '#A2A7B8',
          accent: '#5B5BF0',
          onAccent: '#FFFFFF',
          accent2: '#00B5A4',
          pos: '#14A37A',
          neg: '#F0526A',
          grid: '#EBEEF7',
          shadow: shadowToken(
            '0 24px 50px -24px rgba(50,55,110,0.28)',
            '#32376E',
            24,
            25,
            0.28,
            12,
          ),
          shadowSm: shadowToken(
            '0 6px 18px -10px rgba(50,55,110,0.22)',
            '#32376E',
            6,
            9,
            0.22,
            3,
          ),
        },
        dark: {
          bg: '#0B0D15',
          surface: '#151826',
          surfaceAlt: '#1C2030',
          elev: '#1A1E2D',
          border: '#272C40',
          // Verbatim source anomaly (tokens.md 11.1): 8-digit hex with zero
          // alpha, so halo-dark dividers are invisible exactly as in the
          // prototype. Flagged as a pending design decision; do not "fix"
          // here without one.
          line: '#20253600',
          text: '#ECEEF6',
          dim: '#8B91A6',
          faint: '#5E6478',
          accent: '#8484FF',
          onAccent: '#0B0D15',
          accent2: '#3ED4C4',
          pos: '#34C99A',
          neg: '#FF6A82',
          grid: '#1F2436',
          shadow: shadowToken(
            '0 26px 56px -24px rgba(0,0,0,0.66)',
            '#000000',
            26,
            28,
            0.66,
            13,
          ),
          shadowSm: shadowToken(
            '0 6px 20px -10px rgba(0,0,0,0.5)',
            '#000000',
            6,
            10,
            0.5,
            3,
          ),
        },
      },
    },
  });

// ---------------------------------------------------------------------------
// Resolution (pure functions; Stryker targets)
// ---------------------------------------------------------------------------

export function isThemeDirection(value: unknown): value is ThemeDirection {
  return (
    typeof value === 'string' &&
    (DIR_ORDER as readonly string[]).includes(value)
  );
}

export function isThemeModePreference(
  value: unknown,
): value is ThemeModePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Pure. 'system' resolves via the passed scheme; null/undefined -> 'light'.
 * (Matches the pre-redesign provider behavior and tokens.md section 6.)
 */
export function resolveMode(
  preference: ThemeModePreference,
  systemScheme: ThemeMode | null | undefined,
): ThemeMode {
  if (preference === 'system') {
    return systemScheme ?? 'light';
  }
  return preference;
}

/**
 * Pure. Reproduces the prototype cssVars() palette fallback chain exactly:
 * `t[mode] || t.light || t.dark` (tokens.md section 5 item 1). Generic so the
 * same chain selects palettes and resolved themes.
 */
export function resolvePalette<T>(
  palettes: { readonly light: T; readonly dark: T },
  mode: ThemeMode,
): T;
export function resolvePalette<T>(
  palettes: { readonly light?: T; readonly dark?: T },
  mode: ThemeMode,
): T | undefined;
export function resolvePalette<T>(
  palettes: { readonly light?: T; readonly dark?: T },
  mode: ThemeMode,
): T | undefined {
  return palettes[mode] ?? palettes.light ?? palettes.dark;
}

function buildTheme(direction: ThemeDirection, mode: ThemeMode): GFTheme {
  const def = DEFINITIONS[direction];
  const palette = resolvePalette(def.palettes, mode);
  const c = def.components;
  const colors: ThemeColors = {
    ...palette,
    scrim: SCRIM,
    pushUnderlay: PUSH_UNDERLAY,
    warning: LEGACY_WARNING[mode],
    textPrimary: palette.text,
    textSecondary: palette.dim,
    textFaint: palette.faint,
    danger: palette.neg,
    positive: palette.pos,
    tabBarBg: palette.surface,
    tabActive: palette.accent,
    tabInactive: palette.faint,
    categories: categorySeries(def.cats),
    categoryOther: def.cats.other,
  };
  return deepFreeze({
    direction,
    mode,
    scheme: mode,
    name: def.name,
    tagline: def.tagline,
    colors,
    cats: def.cats,
    fonts: def.fonts,
    radius: {
      sm: def.radiusSm,
      md: def.radius,
      lg: def.radius,
      card: def.radius,
      control: def.radiusSm,
      token: c.tokenRadius,
      chip: c.chipRadius,
      seg: c.segRadius,
      sheet: c.sheetRadius,
      fab: c.fabRadius,
    },
    density: { name: def.density, pad: PAD_BY_DENSITY[def.density] },
    pad: PAD_BY_DENSITY[def.density],
    chart: def.chart,
    chartVariant: def.chart,
    hero: def.hero,
    progressBarHeight: def.progressBarHeight,
    components: c,
    spacing: LEGACY_SPACING,
    text: LEGACY_TEXT_SCALE,
    motion,
    shadows: { sm: palette.shadowSm, lg: palette.shadow },
    segmentedActive: c.segActive,
    card: {
      borderWidth: c.card.borderWidth,
      shadow: c.card.shadow,
      titleVariant: c.cardTitle.variant,
      titleColor: c.cardTitle.variant === 'display' ? 'text' : c.cardTitle.color,
    },
  });
}

/** All eight themes, computed once and frozen (no per-render allocation). */
const RESOLVED: Readonly<
  Record<ThemeDirection, { light: GFTheme; dark: GFTheme }>
> = Object.freeze({
  meridian: Object.freeze({
    light: buildTheme('meridian', 'light'),
    dark: buildTheme('meridian', 'dark'),
  }),
  quant: Object.freeze({
    light: buildTheme('quant', 'light'),
    dark: buildTheme('quant', 'dark'),
  }),
  studio: Object.freeze({
    light: buildTheme('studio', 'light'),
    dark: buildTheme('studio', 'dark'),
  }),
  halo: Object.freeze({
    light: buildTheme('halo', 'light'),
    dark: buildTheme('halo', 'dark'),
  }),
});

/**
 * Pure lookup of a fully resolved, frozen theme. Defensive against junk that
 * could reach it from persisted state at runtime: an unknown direction falls
 * back to 'meridian' (the app default) and an unknown mode follows the
 * prototype's light-then-dark palette fallback chain via resolvePalette().
 */
export function resolveTheme(
  direction: ThemeDirection,
  mode: ThemeMode,
): GFTheme {
  const byMode = RESOLVED[isThemeDirection(direction) ? direction : 'meridian'];
  return resolvePalette(byMode, mode);
}
