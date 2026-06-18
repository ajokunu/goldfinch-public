/**
 * Per-category envelope progress bar (design spec screens.md 3.3): fill =
 * spent/limit clamped to 1 in the category's presentation color, switching to
 * the theme `neg` token when over the limit. Height follows the direction
 * token (halo 10, others 8) unless overridden.
 *
 * Motion (PHASE9-DECISIONS P9-2 item 4): the fill springs to its width on
 * the shared SpringFill primitive -- the `emphasized` spring token's ~6%
 * overshoot, transform-only on the UI thread -- on mount and again whenever
 * the fraction changes. No ad-hoc animation lives here (P9-1); reduced
 * motion / the kill switch park the fill at its final fraction inside the
 * primitive.
 */
import { View } from 'react-native';
import type { MinorUnits } from '@goldfinch/shared/types';

import { SpringFill } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { percentUsed, progressFraction } from '../lib/amounts';

export interface BudgetProgressBarProps {
  spentMinor: MinorUnits;
  limitMinor: MinorUnits;
  /** Category presentation color for the fill; defaults to the accent. */
  color?: string;
  /** Defaults to the direction's progress-bar height token. */
  height?: number;
}

export function BudgetProgressBar({
  spentMinor,
  limitMinor,
  color,
  height,
}: BudgetProgressBarProps) {
  const theme = useTheme();
  const barHeight = height ?? theme.progressBarHeight;
  const fraction = progressFraction(spentMinor, limitMinor);
  const pct = percentUsed(spentMinor, limitMinor);
  const over = pct !== null && pct > 100;

  const fillColor = over ? theme.colors.neg : (color ?? theme.colors.accent);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={
        pct === null ? undefined : { min: 0, max: 100, now: Math.min(pct, 100) }
      }
    >
      <SpringFill
        fraction={fraction}
        color={fillColor}
        height={barHeight}
        trackColor={theme.colors.surfaceAlt}
      />
    </View>
  );
}
