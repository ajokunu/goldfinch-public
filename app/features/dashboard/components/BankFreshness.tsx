/**
 * Bank-data freshness line + on-demand "Sync now".
 *
 * Shows how current the bank data is (summary.asOf = newest account
 * balanceDate). Under ~30h old it reads as a calm "Updated ..." caption;
 * past that it turns into an amber warning so a stale SimpleFIN feed is
 * obvious rather than mistaken for a missing transaction. "Sync now" re-pulls
 * SimpleFIN (POST /sync/run); it does not force SimpleFIN to re-poll the bank,
 * so the help text points at the SimpleFIN portal when the feed itself is old.
 *
 * Staleness threshold reality: SimpleFIN (especially the beta bridge) often
 * takes a few days to register new bank transactions -- that lag is NORMAL,
 * not a fault. So the calm caption covers the whole normal window and the
 * amber "refresh in SimpleFIN" warning only fires past STALE_AFTER (5 days),
 * where the feed is genuinely stuck rather than just lagging. Under that, a
 * muted "(banks can lag a few days)" note sets the expectation.
 */
import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { useRunSync } from '../../../src/api/sync';
import { useLang, useT } from '../../../src/i18n';
import { localeTag } from '../../../src/i18n';
import { logger } from '../../../src/lib/logger';
import { useTheme } from '../../../src/ui/ThemeProvider';

// SimpleFIN often takes a few days to register new transactions (normal lag),
// so only warn once the feed is genuinely stuck rather than merely lagging.
const STALE_AFTER_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
// Within the normal-lag window, set expectations without alarming.
const LAG_NOTE_AFTER_MS = 24 * 60 * 60 * 1000; // 1 day

function relativeAge(asOfEpoch: number, now: number): { label: string; stale: boolean } {
  const ms = now - asOfEpoch * 1000;
  const stale = ms > STALE_AFTER_MS;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return { label: 'just now', stale };
  if (hours < 24) return { label: `${hours}h ago`, stale };
  const days = Math.floor(hours / 24);
  return { label: `${days} day${days === 1 ? '' : 's'} ago`, stale };
}

function formatAsOf(asOfEpoch: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(asOfEpoch * 1000));
  } catch (error) {
    logger.warn('asOf formatting failed; falling back to iso', { error });
    return new Date(asOfEpoch * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function BankFreshness({ asOf }: { asOf: number }) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const runSync = useRunSync();

  const ageMs = Date.now() - asOf * 1000;
  const { label, stale } = relativeAge(asOf, Date.now());
  const lagging = !stale && ageMs > LAG_NOTE_AFTER_MS;
  const color = stale ? theme.colors.accent2 : theme.colors.faint;

  const onSync = useCallback(() => {
    if (runSync.isPending) return;
    runSync.mutate();
  }, [runSync]);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: theme.spacing.sm,
        gap: theme.spacing.sm,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ color, fontSize: 11, fontFamily: theme.fonts.sans, flexShrink: 1 }}
      >
        {t('Bank data')}: {formatAsOf(asOf, localeTag(lang))} {'·'} {label}
        {stale ? ` ${'—'} ${t('refresh in SimpleFIN')}` : ''}
        {lagging ? ` ${t('(banks can lag a few days)')}` : ''}
      </Text>
      <Pressable
        onPress={onSync}
        disabled={runSync.isPending}
        accessibilityRole="button"
        accessibilityLabel={t('Sync now')}
        hitSlop={8}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          opacity: pressed || runSync.isPending ? 0.5 : 1,
        })}
      >
        <RefreshCw size={12} color={theme.colors.accent} strokeWidth={2.2} />
        <Text
          style={{
            color: theme.colors.accent,
            fontSize: 11,
            fontFamily: theme.fonts.sansSet.semibold,
          }}
        >
          {runSync.isPending ? t('Syncing') : t('Sync now')}
        </Text>
      </Pressable>
    </View>
  );
}
