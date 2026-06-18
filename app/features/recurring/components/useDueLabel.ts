/**
 * Due-label composition shared by the Upcoming view and the dashboard
 * upcoming-bills card (design-spec screens.md 1.6 / 6.2): "Due today" /
 * "Tomorrow" / "Overdue · {date}" / "Due {date}", translated where the i18n
 * table carries the key and locale-aware for the date itself. Today/tomorrow
 * are evaluated at call time so a screen left open across midnight stays
 * truthful on the next render (matching the live views' per-render
 * toIsoDate(new Date()) behavior).
 */
import { useMemo } from 'react';
import type { RecurringSeriesDto } from '@goldfinch/shared/types';

import { useLang, useT, localeTag } from '../../../src/i18n';
import { formatTxnDate, isoDateDaysAgo, toIsoDate } from '../../../src/lib/dates';
import { isOverdue } from '../lib/upcoming';

export interface DueLabel {
  text: string;
  overdue: boolean;
}

export function useDueLabel(): (series: RecurringSeriesDto) => DueLabel {
  const t = useT();
  const lang = useLang();

  return useMemo(() => {
    const locale = localeTag(lang);
    return (series: RecurringSeriesDto): DueLabel => {
      const today = toIsoDate(new Date());
      if (isOverdue(series, today)) {
        return {
          text: `${t('Overdue')} · ${formatTxnDate(series.nextExpectedDate, locale)}`,
          overdue: true,
        };
      }
      if (series.nextExpectedDate === today) {
        return { text: t('Due today'), overdue: false };
      }
      // isoDateDaysAgo(-1) is tomorrow (negative days shift forward).
      if (series.nextExpectedDate === isoDateDaysAgo(-1)) {
        return { text: t('Tomorrow'), overdue: false };
      }
      return {
        text: `Due ${formatTxnDate(series.nextExpectedDate, locale)}`,
        overdue: false,
      };
    };
  }, [t, lang]);
}
