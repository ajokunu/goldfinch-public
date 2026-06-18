import * as fs from 'fs';
import * as path from 'path';
import { CfnManagedLoginBranding } from 'aws-cdk-lib/aws-cognito';
import { REPO_ROOT } from './handler-paths';

/**
 * GoldFinch "Meridian" branding for the Cognito Managed Login (v2) pages.
 *
 * Managed Login v2 renders a single set of pages from one branding style, so
 * this document covers BOTH the email sign-in page and the EMAIL_OTP
 * code-entry page (and the passkey prompts) with the same look.
 *
 * The document shape is the Cognito managed-login settings schema (the same
 * one DescribeManagedLoginBranding returns with ReturnMergedResources). Cognito
 * ignores keys outside its schema, so only the supported style tokens are set;
 * everything else falls back to Cognito defaults. Colors are 8-digit
 * RRGGBBAA hex WITHOUT a leading '#', matching the schema's value format.
 */

/** Per-asset Base64 ceiling from the AssetType schema (Bytes max 1,000,000). */
const MAX_ASSET_BASE64_BYTES = 1_000_000;

/** Managed-login asset image categories used by GoldFinch. */
type AssetCategory = 'PAGE_BACKGROUND' | 'FORM_LOGO' | 'FAVICON_ICO' | 'FAVICON_SVG';
type ColorMode = 'LIGHT' | 'DARK' | 'DYNAMIC';
type Extension = 'PNG' | 'JPEG' | 'SVG' | 'ICO' | 'WEBP';

/** A single managed-login image asset (the L1 AssetTypeProperty shape). */
type BrandingAsset = CfnManagedLoginBranding.AssetTypeProperty;

/**
 * GoldFinch Meridian palette as managed-login RRGGBBAA tokens.
 *  - primary: deep green #1E4D3F (sign-in / continue button, primary surfaces)
 *  - accent:  gold #B07D2B (focus ring, links, selected option controls)
 *  - paper:   near-white form surface, translucent so the background image
 *             reads through the card as a soft glass panel.
 */
const COLOR = {
  primary: '1e4d3fff',
  primaryHover: '153a30ff',
  primaryActive: '0f2c24ff',
  onPrimary: 'f7f4ecff',
  accent: 'b07d2bff',
  accentHover: '946623ff',
  accentActive: '7c551dff',
  // Page background fill behind/around the image (deep evergreen) for both
  // modes so uncovered edges harmonize with the photographic background.
  pageFillLight: '12302688',
  pageFillDark: '0c1f1aee',
  // Translucent paper for the form card (light) and a slightly deeper smoked
  // paper (dark). Alpha < ff is what produces the frosted-glass panel.
  formPaperLight: 'faf7f0e6',
  formPaperDark: '1c2b26e6',
  formBorderLight: 'b07d2b55',
  formBorderDark: 'b07d2b66',
  inputBgLight: 'fffefbf2',
  inputBgDark: '24332ef2',
  inputBorderLight: 'd8d0c0ff',
  inputBorderDark: '3c4f48ff',
  placeholderLight: '8c8472ff',
  placeholderDark: '93a39bff',
  headingLight: '17352bff',
  headingDark: 'f1ece0ff',
  bodyLight: '3f5249ff',
  bodyDark: 'd5ddd8ff',
  descriptionLight: '6b7a72ff',
  descriptionDark: 'a9b4aeff',
  labelLight: '2c3f37ff',
  labelDark: 'e2e8e4ff',
  secondaryBgLight: 'faf7f000',
  secondaryBgDark: '1c2b2600',
  secondaryBorderLight: '1e4d3fcc',
  secondaryBorderDark: 'cdd8d2cc',
  secondaryTextLight: '1e4d3fff',
  secondaryTextDark: 'e2e8e4ff',
} as const;

/** Outer-corner rounding for the form card and inputs (radius ~16 / ~12). */
const FORM_BORDER_RADIUS = 16;
const INPUT_BORDER_RADIUS = 12;

/**
 * Read a branding image from the (read-only) app/assets directory and return
 * its Base64-encoded bytes, failing loudly if the file is missing or exceeds
 * the per-asset size ceiling. This runs at synth time; a clear error here is
 * far better than a deploy that silently produces an unbranded login page.
 */
function readAssetBase64(relPathFromRepoRoot: string): string {
  const abs = path.join(REPO_ROOT, relPathFromRepoRoot);
  let raw: Buffer;
  try {
    raw = fs.readFileSync(abs);
  } catch (cause) {
    // eslint-disable-next-line no-console
    console.error(
      `[login-branding] failed to read branding asset at ${abs}; ` +
        'the managed-login style requires this file to exist under app/assets.',
      cause,
    );
    throw new Error(`GoldFinch managed-login branding asset not found: ${relPathFromRepoRoot}`);
  }
  const base64 = raw.toString('base64');
  if (base64.length > MAX_ASSET_BASE64_BYTES) {
    // eslint-disable-next-line no-console
    console.error(
      `[login-branding] branding asset ${relPathFromRepoRoot} is ${base64.length} Base64 bytes, ` +
        `over the ${MAX_ASSET_BASE64_BYTES}-byte Cognito limit; shrink the source image.`,
    );
    throw new Error(
      `GoldFinch managed-login branding asset too large: ${relPathFromRepoRoot} ` +
        `(${base64.length} > ${MAX_ASSET_BASE64_BYTES} Base64 bytes)`,
    );
  }
  return base64;
}

function asset(
  category: AssetCategory,
  colorMode: ColorMode,
  extension: Extension,
  bytes: string,
): BrandingAsset {
  return { category, colorMode, extension, bytes };
}

/**
 * Build the assets[] + settings document for the GoldFinch managed-login style.
 * Provides LIGHT and DARK color modes (the dark variants are cheap since they
 * reuse the same source images and a parallel set of tokens).
 */
export function goldFinchLoginBranding(): {
  settings: Record<string, unknown>;
  assets: BrandingAsset[];
} {
  // app/assets is a read-only input owned by the client workflow.
  const backgroundPng = readAssetBase64('app/assets/login-bg.png');
  const logoPng = readAssetBase64('app/assets/login-logo.png');

  // Each image is emitted ONCE as a browser-adaptive (DYNAMIC) asset rather
  // than duplicated for LIGHT and DARK. The source PNGs are identical across
  // modes, so a single DYNAMIC asset renders in both contexts while the
  // light/dark *color* tokens in `settings` still differentiate the themes.
  // This halves the inlined Base64 payload and keeps the Auth CloudFormation
  // template comfortably under the 1,000,000-byte limit (a hard deploy gate).
  const assets: BrandingAsset[] = [
    // Background image behind the translucent form card.
    asset('PAGE_BACKGROUND', 'DYNAMIC', 'PNG', backgroundPng),
    // GoldFinch mark inside the form card.
    asset('FORM_LOGO', 'DYNAMIC', 'PNG', logoPng),
  ];

  const settings: Record<string, unknown> = {
    components: {
      form: {
        borderRadius: FORM_BORDER_RADIUS,
        logo: {
          enabled: true,
          location: 'CENTER',
          position: 'TOP',
          formInclusion: 'IN',
        },
        // Translucent paper so the background image reads through as glass.
        lightMode: {
          backgroundColor: COLOR.formPaperLight,
          borderColor: COLOR.formBorderLight,
        },
        darkMode: {
          backgroundColor: COLOR.formPaperDark,
          borderColor: COLOR.formBorderDark,
        },
      },
      pageBackground: {
        image: { enabled: true },
        lightMode: { color: COLOR.pageFillLight },
        darkMode: { color: COLOR.pageFillDark },
      },
      // Deep-green primary action (Continue / sign-in / submit OTP).
      primaryButton: {
        lightMode: {
          defaults: { backgroundColor: COLOR.primary, textColor: COLOR.onPrimary },
          hover: { backgroundColor: COLOR.primaryHover, textColor: COLOR.onPrimary },
          active: { backgroundColor: COLOR.primaryActive, textColor: COLOR.onPrimary },
        },
        darkMode: {
          defaults: { backgroundColor: COLOR.primary, textColor: COLOR.onPrimary },
          hover: { backgroundColor: COLOR.primaryHover, textColor: COLOR.onPrimary },
          active: { backgroundColor: COLOR.primaryActive, textColor: COLOR.onPrimary },
        },
      },
      // Quiet, green-outlined secondary actions (e.g. "Use another method").
      secondaryButton: {
        lightMode: {
          defaults: {
            backgroundColor: COLOR.secondaryBgLight,
            borderColor: COLOR.secondaryBorderLight,
            textColor: COLOR.secondaryTextLight,
          },
          hover: {
            backgroundColor: COLOR.formPaperLight,
            borderColor: COLOR.primary,
            textColor: COLOR.primaryHover,
          },
          active: {
            backgroundColor: COLOR.formPaperLight,
            borderColor: COLOR.primaryActive,
            textColor: COLOR.primaryActive,
          },
        },
        darkMode: {
          defaults: {
            backgroundColor: COLOR.secondaryBgDark,
            borderColor: COLOR.secondaryBorderDark,
            textColor: COLOR.secondaryTextDark,
          },
          hover: {
            backgroundColor: COLOR.formPaperDark,
            borderColor: COLOR.onPrimary,
            textColor: COLOR.onPrimary,
          },
          active: {
            backgroundColor: COLOR.formPaperDark,
            borderColor: COLOR.onPrimary,
            textColor: COLOR.onPrimary,
          },
        },
      },
      pageText: {
        lightMode: {
          headingColor: COLOR.headingLight,
          bodyColor: COLOR.bodyLight,
          descriptionColor: COLOR.descriptionLight,
        },
        darkMode: {
          headingColor: COLOR.headingDark,
          bodyColor: COLOR.bodyDark,
          descriptionColor: COLOR.descriptionDark,
        },
      },
    },
    componentClasses: {
      input: {
        borderRadius: INPUT_BORDER_RADIUS,
        lightMode: {
          defaults: { backgroundColor: COLOR.inputBgLight, borderColor: COLOR.inputBorderLight },
          placeholderColor: COLOR.placeholderLight,
        },
        darkMode: {
          defaults: { backgroundColor: COLOR.inputBgDark, borderColor: COLOR.inputBorderDark },
          placeholderColor: COLOR.placeholderDark,
        },
      },
      inputLabel: {
        lightMode: { textColor: COLOR.labelLight },
        darkMode: { textColor: COLOR.labelDark },
      },
      // Gold links to match the accent.
      link: {
        lightMode: {
          defaults: { textColor: COLOR.accent },
          hover: { textColor: COLOR.accentHover },
        },
        darkMode: {
          defaults: { textColor: COLOR.accent },
          hover: { textColor: COLOR.accentHover },
        },
      },
      // Gold focus ring for visible keyboard focus on inputs.
      focusState: {
        lightMode: { borderColor: COLOR.accent },
        darkMode: { borderColor: COLOR.accent },
      },
      optionControls: {
        lightMode: {
          defaults: { backgroundColor: COLOR.inputBgLight, borderColor: COLOR.inputBorderLight },
          selected: { backgroundColor: COLOR.accent, foregroundColor: COLOR.onPrimary },
        },
        darkMode: {
          defaults: { backgroundColor: COLOR.inputBgDark, borderColor: COLOR.inputBorderDark },
          selected: { backgroundColor: COLOR.accent, foregroundColor: COLOR.onPrimary },
        },
      },
    },
    categories: {
      form: {
        displayGraphics: true,
        instructions: { enabled: true },
        languageSelector: { enabled: false },
        location: { horizontal: 'CENTER', vertical: 'CENTER' },
      },
      global: {
        // Browser-adaptive: light/dark tokens above are both honored.
        colorSchemeMode: 'DYNAMIC',
        pageHeader: { enabled: false },
        pageFooter: { enabled: false },
        spacingDensity: 'REGULAR',
      },
    },
  };

  return { settings, assets };
}
