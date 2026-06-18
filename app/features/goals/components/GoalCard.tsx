/**
 * One goal card (design-spec screens.md 5.3): progress ring left (size/stroke
 * from theme structural tokens, color via the deterministic presentation
 * assignment), name + mono saved/target line + Calendar meta line right, and
 * an action row -- ghost "Add funds" for manual goals only (the contribution
 * POST 404s on linked goals; linked goals show a muted "Funded by {account}"
 * caption instead), a Pencil icon-pill for edit, and a MoreHorizontal
 * overflow that opens the existing delete confirm (live capability, not in
 * the prototype, deliberately preserved).
 *
 * The ring fill is the SERVER-computed percentComplete (clamped at 100 for
 * the arc only); the label shows the true percent even past 100.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Calendar, MoreHorizontal, Pencil, Plus } from 'lucide-react-native';
import type { GoalDto, IsoDate } from '@goldfinch/shared/types';

import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { Button } from '../../../src/ui/Button';
import { Card } from '../../../src/ui/Card';
import { IconButton } from '../../../src/ui/IconButton';
import { ParticleBurst, useHaptics } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { ProgressRing, categoryColor } from '../../../src/ui/charts';
import { useLang, useT, localeTag } from '../../../src/i18n';
import { formatTxnDate } from '../../../src/lib/dates';
import { logger } from '../../../src/lib/logger';
import {
  paceStatus,
  projectCompletion,
  type GoalProjection,
  type PaceStatus,
} from '../lib/projection';

export interface GoalCardProps {
  goal: GoalDto;
  /** Resolved linked-account name; undefined while accounts load or on lookup miss. */
  accountName?: string;
  /** Local-calendar today, pinned once per screen mount. */
  today: IsoDate;
  onEdit: (goal: GoalDto) => void;
  onContribute: (goal: GoalDto) => void;
  onDelete: (goal: GoalDto) => void;
}

/**
 * Projection math throws ProjectionError on malformed data; a single corrupt
 * goal must not crash the list, so the card degrades to the targetDate
 * fallback and logs the cause (house rule: every catch logs).
 */
function safeProjection(goal: GoalDto, today: IsoDate): GoalProjection | null {
  try {
    return projectCompletion({
      progressMinor: goal.progressMinor,
      targetMinor: goal.targetMinor,
      createdAt: goal.createdAt,
      today,
    });
  } catch (error) {
    logger.warn('goals: projection failed', { goalId: goal.goalId, error });
    return null;
  }
}

export function GoalCard({
  goal,
  accountName,
  today,
  onEdit,
  onContribute,
  onDelete,
}: GoalCardProps) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const locale = localeTag(lang);
  const haptics = useHaptics();
  // The saved/target line renders raw formatMinorAmount strings (and mirrors
  // them into accessibilityLabels) instead of the Money primitive, so privacy
  // mode masks both the visible text and the labels here.
  const { mask } = useMaskMoney();

  // Goal-completion delight (PHASE9-DECISIONS P9-2 items 7 + 10): when the
  // server-computed percent CROSSES 100 while this card is mounted (a
  // contribution or linked-balance refresh lands), fire one particle burst
  // in the category palette and the medium milestone haptic. A goal that is
  // already complete on mount earned its moment in the past -- no replay.
  const complete = goal.percentComplete >= 100;
  const wasComplete = useRef(complete);
  const [burstKey, setBurstKey] = useState<number | null>(null);
  useEffect(() => {
    if (complete && !wasComplete.current) {
      setBurstKey(Date.now());
      haptics.milestone();
    }
    wasComplete.current = complete;
  }, [complete, haptics]);

  const projection = useMemo(() => safeProjection(goal, today), [goal, today]);
  const pace: PaceStatus | null =
    projection === null ? null : paceStatus(projection, goal.targetDate);

  // Direction structural variants via theme tokens (screens.md 0.5 "goal
  // ring"): halo (hero 'ring') upsizes to 70; studio (chart 'block') thickens
  // the stroke to 9. Never a direction branch.
  const ringSize = theme.hero === 'ring' ? 70 : 64;
  const ringStroke = theme.chartVariant === 'block' ? 9 : 7;
  const goalColor = categoryColor(goal.goalId, theme.colors.categories);

  // Meta line: "{linked account name | Manual} · ETA {date}". The accounts
  // query degrades independently: a linked goal whose name lookup missed
  // shows the generic label, never blocks (preserved behavior). ETA comes
  // from the pace projection; without one, the explicit targetDate is shown
  // ("Target {date}") or the segment is omitted -- no invented dates.
  const sourceLabel =
    goal.fundingMode === 'linked-account'
      ? (accountName ?? 'Linked account')
      : t('Manual');
  const etaLabel =
    projection?.kind === 'projected'
      ? `${t('ETA')} ${formatTxnDate(projection.date, locale)}`
      : projection?.kind === 'achieved'
        ? 'Goal reached'
        : goal.targetDate
          ? `Target ${formatTxnDate(goal.targetDate, locale)}`
          : null;
  const paceColor =
    pace === 'behind'
      ? theme.colors.warning
      : pace === 'on-track'
        ? theme.colors.positive
        : theme.colors.textSecondary;

  return (
    <Card>
      <View style={styles.bodyRow}>
        <ProgressRing
          fraction={goal.percentComplete / 100}
          size={ringSize}
          strokeWidth={ringStroke}
          color={goalColor}
          label={`${goal.percentComplete}%`}
          percentComplete={goal.percentComplete}
        />
        <View style={styles.textStack}>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.textPrimary,
              fontSize: 16,
              fontWeight: '700',
              fontFamily: theme.fonts.sansSet.bold,
            }}
          >
            {goal.name}
          </Text>
          <View style={[styles.amountRow, { marginTop: 3 }]}>
            <Text
              style={{
                color: theme.colors.textPrimary,
                fontSize: 13.5,
                fontWeight: '700',
                fontFamily: theme.fonts.monoSet.bold,
                fontVariant: ['tabular-nums'],
              }}
              accessibilityLabel={mask(
                formatMinorAmount(goal.progressMinor, goal.currency, {
                  locale,
                }),
              )}
            >
              {mask(
                formatMinorAmount(goal.progressMinor, goal.currency, {
                  locale,
                }),
              )}
            </Text>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 13.5,
                fontFamily: theme.fonts.mono,
                fontVariant: ['tabular-nums'],
              }}
              accessibilityLabel={mask(
                formatMinorAmount(goal.targetMinor, goal.currency, { locale }),
              )}
            >
              {` / ${mask(formatMinorAmount(goal.targetMinor, goal.currency, { locale }))}`}
            </Text>
          </View>
          <View style={[styles.metaRow, { marginTop: 5 }]}>
            <Calendar size={13} color={theme.colors.textSecondary} />
            <Text
              numberOfLines={1}
              style={[
                styles.metaText,
                {
                  color: theme.colors.textSecondary,
                  fontSize: 12,
                  fontFamily: theme.fonts.sans,
                },
              ]}
            >
              {sourceLabel}
              {etaLabel ? (
                <>
                  {' · '}
                  <Text style={{ color: paceColor }}>{etaLabel}</Text>
                </>
              ) : null}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.actions, { marginTop: 14 }]}>
        {goal.fundingMode === 'manual' ? (
          <Button
            label={t('Add funds')}
            variant="ghost"
            icon={Plus}
            onPress={() => onContribute(goal)}
            style={styles.actionFlex}
          />
        ) : (
          <Text
            numberOfLines={1}
            style={[
              styles.actionFlex,
              styles.fundedBy,
              {
                color: theme.colors.textSecondary,
                fontSize: 12.5,
                fontFamily: theme.fonts.sans,
              },
            ]}
          >
            {`Funded by ${accountName ?? 'linked account'}`}
          </Text>
        )}
        <IconButton
          icon={Pencil}
          variant="pill"
          onPress={() => onEdit(goal)}
          accessibilityLabel={`Edit goal ${goal.name}`}
        />
        <IconButton
          icon={MoreHorizontal}
          variant="pill"
          onPress={() => onDelete(goal)}
          accessibilityLabel={`Delete goal ${goal.name}`}
        />
      </View>
      <ParticleBurst
        colors={theme.colors.categories}
        trigger={burstKey}
        testID={`goal-burst-${goal.goalId}`}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  bodyRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  textStack: { flex: 1, minWidth: 0 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionFlex: { flex: 1 },
  fundedBy: { alignSelf: 'center' },
});
