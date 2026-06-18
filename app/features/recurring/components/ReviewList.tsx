/**
 * Detected-series review (design-spec screens.md 6.3, P7-1 wiring intact):
 *
 * - Detection banner (dashed accent2 border + Sparkles) when detected series
 *   exist, then one card per detected series with Confirm (primary, Check) +
 *   Ignore (outline) actions, each flex 1.
 * - Confirmed / Ignored sections PRESERVED from live (the prototype omits
 *   them): subdued text actions flip status later. PATCH only accepts
 *   'confirmed' | 'ignored' -- there is no path back to 'detected'.
 * - Designed review-empty state (Sparkles + "Nothing to review") when nothing
 *   is detected; the confirmed/ignored sections still render below.
 *
 * Actions are optimistic (useReviewSeries flips the cached status in
 * onMutate; the same hook logs failures with series context), so rows move
 * between sections instantly; failures roll back and surface in an inline
 * alert banner -- never silently.
 */
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Sparkles } from 'lucide-react-native';
import type { RecurringSeriesDto } from '@goldfinch/shared/types';

import { Button } from '../../../src/ui/Button';
import { Card } from '../../../src/ui/Card';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useHover } from '../../../src/ui/useHover';
import { FadeRise, stagger, staggerChildDelayMs } from '../../../src/ui/motion';
import { useLang, useT, localeTag } from '../../../src/i18n';
import { formatTxnDate } from '../../../src/lib/dates';
import { useReviewSeries, type ReviewSeriesVars } from '../hooks/useReviewSeries';
import { reviewErrorMessage } from '../lib/errors';
import { seriesByStatus } from '../lib/upcoming';
import { SeriesRow } from './SeriesRow';

function SectionHeader({ title, count }: { title: string; count: number }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: theme.colors.textSecondary,
        fontSize: 11,
        fontWeight: '700',
        fontFamily: theme.fonts.sansSet.bold,
        textTransform: 'uppercase',
        letterSpacing: 0.88,
        marginBottom: 8,
      }}
    >
      {`${title} (${count})`}
    </Text>
  );
}

/** Subdued text action on confirmed/ignored rows ("Ignore" / "Confirm"). */
function TextAction({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover(!disabled);
  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => ({
        opacity: disabled ? 0.5 : pressed ? 0.6 : hovered ? 0.8 : 1,
      })}
    >
      <Text
        style={{
          color: theme.colors.accent,
          fontSize: 13,
          fontWeight: '600',
          fontFamily: theme.fonts.sansSet.semibold,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Designed review-empty state (screens.md 6.3). */
function ReviewEmptyState() {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <Sparkles size={26} color={theme.colors.faint} strokeWidth={2} />
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: 16,
          fontWeight: '700',
          fontFamily: theme.fonts.sansSet.bold,
          marginTop: 10,
          textAlign: 'center',
        }}
      >
        Nothing to review
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 13,
          fontFamily: theme.fonts.sans,
          marginTop: 6,
          textAlign: 'center',
          maxWidth: 320,
        }}
      >
        New detections appear here after each sync.
      </Text>
    </View>
  );
}

export function ReviewList({ items }: { items: readonly RecurringSeriesDto[] }) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const locale = localeTag(lang);
  const review = useReviewSeries();
  const [actionError, setActionError] = useState<string | null>(null);

  const detected = seriesByStatus(items, 'detected');
  const confirmed = seriesByStatus(items, 'confirmed');
  const ignored = seriesByStatus(items, 'ignored');

  const pendingSeriesId = review.isPending ? review.variables?.seriesId : undefined;

  const act = (vars: ReviewSeriesVars) => {
    setActionError(null);
    review.mutate(vars, {
      // Rollback + logging happen in the hook; this surfaces the failure.
      onError: (error) => setActionError(reviewErrorMessage(error)),
    });
  };

  /** "Last Jun 2 · 4 occurrences · Chase Checking" context line. */
  const reviewDetail = (series: RecurringSeriesDto): string => {
    const parts = [
      `Last ${formatTxnDate(series.lastDate, locale)}`,
      `${series.occurrenceCount} occurrences`,
    ];
    if (series.accountName) parts.push(series.accountName);
    return parts.join(' · ');
  };

  const renderStatusSection = (
    title: string,
    sectionItems: RecurringSeriesDto[],
    actionLabel: string,
    nextStatus: 'confirmed' | 'ignored',
  ) =>
    sectionItems.length === 0 ? null : (
      <View>
        <SectionHeader title={title} count={sectionItems.length} />
        <Card>
          {sectionItems.map((series, position) => (
            <Fragment key={series.seriesId}>
              {position > 0 ? (
                <View
                  style={[styles.divider, { backgroundColor: theme.colors.line }]}
                />
              ) : null}
              <View style={styles.rowPad}>
                <SeriesRow
                  series={series}
                  detail={reviewDetail(series)}
                  actions={
                    <TextAction
                      label={actionLabel}
                      disabled={pendingSeriesId === series.seriesId}
                      onPress={() =>
                        act({ seriesId: series.seriesId, status: nextStatus })
                      }
                    />
                  }
                />
              </View>
            </Fragment>
          ))}
        </Card>
      </View>
    );

  return (
    <View style={styles.stack}>
      {actionError ? (
        <View
          accessibilityRole="alert"
          style={{
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.danger,
            borderWidth: 1,
            borderRadius: theme.radius.card,
            padding: 14,
          }}
        >
          <Text
            style={{
              color: theme.colors.danger,
              fontSize: 12.5,
              fontFamily: theme.fonts.sans,
            }}
          >
            {actionError}
          </Text>
        </View>
      ) : null}

      {detected.length > 0 ? (
        <>
          {/* Banner-then-cards cascade via the shared motion module
              (PHASE9-DECISIONS P9-1/P9-2 item 1). */}
          <FadeRise>
            <View
              style={[
                styles.banner,
                {
                  borderColor: theme.colors.accent2,
                  borderRadius: theme.radius.card,
                },
              ]}
            >
              <Sparkles size={18} color={theme.colors.accent2} strokeWidth={2.1} />
              <Text
                style={[
                  styles.bannerText,
                  {
                    color: theme.colors.textPrimary,
                    fontSize: 13,
                    fontFamily: theme.fonts.sans,
                  },
                ]}
              >
                {detected.length === 1
                  ? 'We spotted 1 possible new subscription.'
                  : `We spotted ${detected.length} possible new subscriptions.`}
              </Text>
            </View>
          </FadeRise>
          {detected.map((series, position) => (
            <FadeRise
              key={series.seriesId}
              delay={staggerChildDelayMs(position + 1, stagger.cascadeMs)}
            >
              <Card>
                <SeriesRow
                  series={series}
                  detail={reviewDetail(series)}
                  actions={
                    <>
                      <Button
                        label={t('Confirm')}
                        icon={Check}
                        disabled={pendingSeriesId === series.seriesId}
                        onPress={() =>
                          act({ seriesId: series.seriesId, status: 'confirmed' })
                        }
                        style={styles.actionFlex}
                      />
                      <Button
                        label={t('Ignore')}
                        variant="outline"
                        disabled={pendingSeriesId === series.seriesId}
                        onPress={() =>
                          act({ seriesId: series.seriesId, status: 'ignored' })
                        }
                        style={styles.actionFlex}
                      />
                    </>
                  }
                />
              </Card>
            </FadeRise>
          ))}
        </>
      ) : (
        <ReviewEmptyState />
      )}

      {renderStatusSection('Confirmed', confirmed, t('Ignore'), 'ignored')}
      {renderStatusSection('Ignored', ignored, t('Confirm'), 'confirmed')}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerText: { flex: 1 },
  actionFlex: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  rowPad: { paddingVertical: 8 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
});
