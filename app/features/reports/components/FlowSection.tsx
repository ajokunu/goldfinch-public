/**
 * Income -> category flow for the selected month (P7-4, restyled per
 * design-spec/screens.md 4.4): a 330px two-column FlowDiagram per currency
 * group (P7-7: never merged) in the active direction's treatment, headed by
 * the Income / Spending / Saved figures row that reconciles deficit months
 * (FlowDiagram contract: the left bar is the honest outflow bar; income
 * context lives up here).
 *
 * Node composition comes from buildFlowTargets: categories beyond
 * FLOW_MAX_CATEGORY_NODES fold into "Other", and a positive month remainder
 * (income - expense) becomes an explicit "Unallocated" node. Colors are the
 * deterministic presentation-only assignment (screens.md 0.3): stable hash
 * of the category id into the direction's ordered palette; the uncategorized
 * bucket and the folded "Other" node take the palette's `other` slot;
 * "Unallocated" stays the muted border token. Transfers are already excluded
 * server-side.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  FlowCurrencyGroupDto,
  IsoMonth,
  ReportsFlowResponse,
} from '@goldfinch/shared/types';

import { useT } from '../../../src/i18n';
import { categoryColor, FlowDiagram } from '../../../src/ui/charts';
import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { CountUp } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';
import type { Theme } from '../../../src/ui/theme';
import {
  buildFlowTargets,
  flowGroupHasContent,
  truncateFlowLabel,
  type FlowTarget,
} from '../lib/series';
import { CurrencyHeading } from './CurrencyHeading';

/** Diagram height per screens.md 4.4 (node slots stay legible up to the
 *  FLOW_MAX_CATEGORY_NODES + 1 cap at ~36px each). */
const FLOW_HEIGHT = 330;

/**
 * Deterministic node coloring (screens.md 0.3): real categories hash into
 * the direction's ordered palette; the null-id uncategorized bucket and the
 * synthetic "Other" fold take the `other` slot; "Unallocated" stays muted.
 */
function targetColor(target: FlowTarget, theme: Theme): string {
  if (target.kind === 'unallocated') return theme.colors.border;
  if (target.kind === 'other' || target.categoryId === null) {
    return theme.colors.categoryOther;
  }
  return categoryColor(target.categoryId, theme.colors.categories);
}

function CurrencyFlow({
  group,
  month,
}: {
  group: FlowCurrencyGroupDto;
  month: IsoMonth;
}) {
  const theme = useTheme();
  const t = useT();
  // The sankey amount lines (formatValue, rendered as SVG text under each
  // node) and the diagram's screen-reader summary are pre-formatted money
  // strings outside the CountUp primitive, so privacy mode masks them here.
  const { mask } = useMaskMoney();
  const targets = useMemo(() => buildFlowTargets(group), [group]);

  const figures = [
    {
      label: t('Income'),
      amountMinor: group.incomeMinor,
      colorBySign: false,
    },
    {
      label: t('Spending'),
      amountMinor: group.expenseMinor,
      colorBySign: false,
    },
    { label: t('Saved'), amountMinor: group.netMinor, colorBySign: true },
  ];

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={[styles.figuresRow, { gap: theme.spacing.lg }]}>
        {figures.map((figure) => (
          <View key={figure.label} style={styles.figure}>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 11.5,
                fontFamily: theme.fonts.sans,
              }}
            >
              {figure.label}
            </Text>
            {/* Flow figures headline (PHASE9-DECISIONS P9-2 item 4):
                rolling-digit CountUp on mount and on value change. */}
            <CountUp
              amountMinor={figure.amountMinor}
              currency={group.currency}
              colorBySign={figure.colorBySign}
              size="sm"
              style={{
                fontFamily: theme.fonts.monoSet.semibold,
                // The mono family IS the weight cut; never synthesize on
                // top of a loaded custom font (tokens.md 8.3).
                fontWeight: 'normal',
              }}
            />
          </View>
        ))}
      </View>
      <FlowDiagram
        source={{
          label: t('Income'),
          value: group.incomeMinor,
          color: theme.colors.positive,
        }}
        targets={targets.map((target) => ({
          // Category names are API data: rendered verbatim, only truncated
          // for the SVG label column (charts.md 6.3), never translated.
          label: truncateFlowLabel(target.label),
          value: target.valueMinor,
          color: targetColor(target, theme),
        }))}
        height={FLOW_HEIGHT}
        animationKey={month}
        // Flow values are the API's exact integer minor units (no ticks
        // here), so they format directly.
        formatValue={(value) => mask(formatMinorAmount(value, group.currency))}
        accessibilityLabel={`${t('Income')} ${mask(formatMinorAmount(group.incomeMinor, group.currency))}, ${t('Spending')} ${mask(formatMinorAmount(group.expenseMinor, group.currency))} (${group.currency})`}
        testID={`reports-flow-diagram-${group.currency}`}
      />
    </View>
  );
}

export function FlowSection({ response }: { response: ReportsFlowResponse }) {
  const theme = useTheme();
  // The caller gates the all-empty month on flowIsEmpty; groups that have
  // nothing drawable (defensive -- the server normally omits them) are
  // filtered rather than rendered as blank diagrams.
  const groups = (response.perCurrency ?? []).filter(flowGroupHasContent);
  const multiCurrency = groups.length > 1;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {groups.map((group) => (
        <View key={group.currency} style={{ gap: theme.spacing.xs }}>
          {multiCurrency ? <CurrencyHeading currency={group.currency} /> : null}
          <CurrencyFlow group={group} month={response.month} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  figuresRow: { flexDirection: 'row', flexWrap: 'wrap' },
  figure: { gap: 2 },
});
