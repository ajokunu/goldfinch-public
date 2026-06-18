/**
 * The union of all four theme directions' font cuts (6 families, 22 cuts),
 * loaded once at startup so direction switching is instant with no reload
 * flash (tokens.md section 8.3). Map keys are the registered fontFamily
 * strings and MUST match the FontCutSet values in themeResolve.ts -- the
 * @expo-google-fonts export names are exactly those strings.
 *
 * Kept separate from theme.ts/themeResolve.ts because importing font assets
 * drags in the Metro asset system, which would break the pure node --test
 * coverage of theme resolution.
 */
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Newsreader_500Medium,
  Newsreader_600SemiBold,
} from '@expo-google-fonts/newsreader';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_700Bold,
  SchibstedGrotesk_800ExtraBold,
} from '@expo-google-fonts/schibsted-grotesk';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';

export const THEME_FONT_ASSETS = {
  // meridian display (serif); 500/600 are the only cuts the prototype uses.
  Newsreader_500Medium,
  Newsreader_600SemiBold,
  // meridian + studio sans.
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
  // all directions: mono (money / tabular numbers).
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
  // quant display + sans (family ships no 800; quant maxes at 700).
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  // studio display.
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_700Bold,
  SchibstedGrotesk_800ExtraBold,
  // halo display + sans.
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} as const;
