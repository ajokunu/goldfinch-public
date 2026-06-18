/**
 * Total-saved hero card (design-spec screens.md 5.2). Studio renders its
 * accent-hero treatment (accent surface + on-accent content); every other
 * direction uses the normal card surface. The structural signal is the
 * theme's hero token ('editorial' is studio's), never a direction branch.
 *
 * Money: per-currency integer sums from lib/totals.ts. The single hero
 * number + count-up renders only when every goal shares one currency;
 * otherwise one compact "{saved} / {target} CUR" line per currency with a
 * thin bar each -- never a synthetic combined total. The saved/target ratio
 * is layout-only (progressFraction).
 */
import { StyleSheet, Text, View } from 'react-native';
import type { GoalDto } from '@goldfinch/shared/types';

import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { withAlpha } from '../../../src/ui/mixColor';
import { shadowStyle } from '../../../src/ui/shadows';
import { useLang, localeTag } from '../../../src/i18n';
import { progressFraction } from '../lib/inputs';
import { goalTotalsByCurrency, type GoalCurrencyTotal } from '../lib/totals';
import { AnimatedMinorAmount } from './AnimatedMinorAmount';

export interface TotalSavedCardProps {
  goals: readonly GoalDto[];
}

function HeroBar({
  fraction,
  height,
  trackColor,
  fillColor,
  percent,
}: {
  fraction: number;
  height: number;
  trackColor: string;
  fillColor: string;
  /** For accessibilityValue.now, clamped to 100. */
  percent: number;
}) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.min(percent, 100) }}
      style={[
        styles.track,
        { height, borderRadius: height / 2, backgroundColor: trackColor },
      ]}
    >
      <View
        style={{
          width: `${fraction * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: fillColor,
        }}
      />
    </View>
  );
}

/** Layout-only integer percent for the bar's accessibility value. */
function flooredPercent(total: GoalCurrencyTotal): number {
  if (total.targetMinor <= 0) return total.savedMinor > 0 ? 100 : 0;
  return Math.floor(
    (Math.max(0, total.savedMinor) * 100) / total.targetMinor,
  );
}

export function TotalSavedCard({ goals }: TotalSavedCardProps) {
  const theme = useTheme();
  const lang = useLang();
  const locale = localeTag(lang);
  // The "/ target" line and the multi-currency saved/target rows render raw
  // formatMinorAmount strings (the hero number rides the masking-aware
  // AnimatedMinorAmount), so privacy mode masks them here.
  const { mask } = useMaskMoney();

  const totals = goalTotalsByCurrency(goals);
  if (totals.length === 0) return null;

  // Studio's accent-hero structural variant, signalled by the hero token.
  const accentHero = theme.hero === 'editorial';
  const surfaceColor = accentHero ? theme.colors.accent : theme.colors.surface;
  const primary = accentHero ? theme.colors.onAccent : theme.colors.textPrimary;
  const muted = accentHero ? theme.colors.onAccent : theme.colors.textSecondary;
  const trackColor = accentHero
    ? withAlpha(theme.colors.onAccent, 0.25)
    : theme.colors.surfaceAlt;
  const fillColor = accentHero ? theme.colors.onAccent : theme.colors.accent;

  const caption =
    goals.length === 1
      ? 'Total saved across 1 goal'
      : `Total saved across ${goals.length} goals`;

  const single = totals.length === 1 ? totals[0] : undefined;

  return (
    <View
      style={[
        {
          backgroundColor: surfaceColor,
          borderColor: accentHero ? theme.colors.accent : theme.colors.border,
          borderWidth: theme.card.borderWidth,
          borderRadius: theme.radius.card,
          padding: 16,
        },
        theme.card.shadow === 'sm' ? shadowStyle(theme.shadows.sm) : null,
      ]}
    >
      <Text
        style={{
          color: muted,
          opacity: accentHero ? 0.8 : 1,
          fontSize: 11.5,
          fontWeight: '700',
          fontFamily: theme.fonts.sansSet.bold,
          textTransform: 'uppercase',
          letterSpacing: 0.92,
        }}
      >
        {caption}
      </Text>

      {single ? (
        <>
          <View style={[styles.heroRow, { marginTop: 8 }]}>
            <AnimatedMinorAmount
              amountMinor={single.savedMinor}
              currency={single.currency}
              locale={locale}
              style={{
                color: primary,
                fontSize: 34,
                fontFamily: theme.fonts.display,
                fontWeight: theme.fonts.displayWeight,
                fontVariant: ['tabular-nums'],
              }}
            />
            <Text
              style={{
                color: muted,
                opacity: accentHero ? 0.75 : 1,
                fontSize: 14,
                fontFamily: theme.fonts.mono,
                fontVariant: ['tabular-nums'],
              }}
            >
              {` / ${mask(formatMinorAmount(single.targetMinor, single.currency, { locale }))}`}
            </Text>
          </View>
          <View style={{ marginTop: 12 }}>
            <HeroBar
              fraction={progressFraction(single.savedMinor, single.targetMinor)}
              height={theme.progressBarHeight}
              trackColor={trackColor}
              fillColor={fillColor}
              percent={flooredPercent(single)}
            />
          </View>
        </>
      ) : (
        <View style={{ marginTop: 10, gap: 10 }}>
          {totals.map((total) => (
            <View key={total.currency} style={{ gap: 6 }}>
              <View style={styles.heroRow}>
                <Text
                  style={{
                    color: primary,
                    fontSize: 17,
                    fontWeight: '700',
                    fontFamily: theme.fonts.monoSet.bold,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {mask(formatMinorAmount(total.savedMinor, total.currency, { locale }))}
                </Text>
                <Text
                  style={{
                    color: muted,
                    opacity: accentHero ? 0.75 : 1,
                    fontSize: 13,
                    fontFamily: theme.fonts.mono,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {` / ${mask(formatMinorAmount(total.targetMinor, total.currency, { locale }))} ${total.currency}`}
                </Text>
              </View>
              <HeroBar
                fraction={progressFraction(total.savedMinor, total.targetMinor)}
                height={4}
                trackColor={trackColor}
                fillColor={fillColor}
                percent={flooredPercent(total)}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  track: { overflow: 'hidden', width: '100%' },
});
