/**
 * Applies a platform-split ShadowToken (tokens.md section 4.1): exact
 * prototype box-shadow on web, derived shadow props on iOS, elevation on
 * Android (system-colored below API 28; tint is intentionally dropped).
 */
import { Platform, type ViewStyle } from 'react-native';

import type { ShadowToken } from './theme';

export function shadowStyle(token: ShadowToken): ViewStyle {
  if (Platform.OS === 'web') {
    return { boxShadow: token.web };
  }
  if (Platform.OS === 'android') {
    return { elevation: token.android.elevation };
  }
  return {
    shadowColor: token.ios.shadowColor,
    shadowOffset: token.ios.shadowOffset,
    shadowOpacity: token.ios.shadowOpacity,
    shadowRadius: token.ios.shadowRadius,
  };
}
