/**
 * Dashboard header row (screens.md 1.2): muted weekday-date line over a
 * time-of-day greeting in the direction's display face, with a 40px avatar
 * token on the right navigating to the More/Settings hub.
 *
 * Identity prefers the user-chosen profile display name (GET /profile via
 * useProfile; the server keys the item by the JWT sub, so each spouse sees
 * her own name) and falls back to the stored Cognito ID token's display
 * claims (shell.md 3.1): given name, then name, then the email local-part.
 * Claims are display-only and never trusted for authorization; profile-read
 * and decode failures log and degrade down the fallback chain to the bare
 * greeting (never mock names).
 *
 * P8 greeting name edit: the greeting itself is pressable (kit hover
 * treatment on web) and opens GreetingNameSheet -- the same display-name
 * FormField + optimistic PATCH as Settings -- so the name is editable right
 * at the welcome screen. The avatar keeps its More/Settings navigation.
 *
 * GAP (screens.md 1.2): the prototype's notification bell is omitted -- no
 * notifications feed exists in the API, and dead buttons are forbidden.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Eye, EyeOff, User } from 'lucide-react-native';

import { greeting, localeTag, useLang, useT } from '../../../src/i18n';
import { useProfile } from '../../../src/api/profile';
import { useUiStore } from '../../../src/state/uiStore';
import { getIdToken } from '../../../src/auth/tokenStore';
import { decodeJwtPayload } from '../../../src/lib/jwt';
import { logger } from '../../../src/lib/logger';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  hoverBackground,
  hoverTransitionStyle,
  useHover,
} from '../../../src/ui/useHover';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';
import { headerDateLine } from '../lib/labels';
import { GreetingNameSheet } from './GreetingNameSheet';

const log = logger.child({ screen: 'dashboard' });

interface ProfileIdentity {
  /** Claim-derived fallback name: given_name -> name -> email local-part. */
  name: string | null;
}

function claimString(
  claims: Record<string, unknown>,
  key: string,
): string | null {
  const value = claims[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Display claims from the stored ID token; never fake, never throws. */
function useClaimIdentity(): ProfileIdentity {
  const [identity, setIdentity] = useState<ProfileIdentity>({ name: null });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await getIdToken();
        if (token === null) return;
        const claims = decodeJwtPayload(token);
        if (claims === null) {
          log.warn('profile claims unavailable', {
            reason: 'id token payload undecodable',
          });
          return;
        }
        const email = claimString(claims, 'email');
        const emailLocal = email === null ? null : (email.split('@')[0] ?? null);
        const name =
          claimString(claims, 'given_name') ??
          claimString(claims, 'name') ??
          emailLocal;
        if (mounted) setIdentity({ name });
      } catch (error) {
        log.warn('profile claims unavailable', { error });
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return identity;
}

/**
 * Greeting name: the chosen profile display name wins; the claim chain is
 * the fallback so an unset/unreachable profile degrades to today's behavior.
 */
function useGreetingName(): string | null {
  const { name: claimName } = useClaimIdentity();
  const { data: profile, error: profileError } = useProfile();
  useEffect(() => {
    // Degrading to the claim chain is the designed behavior, but the failure
    // itself is never silent (P7-10). 404 is mapped to data upstream, so any
    // error here is a real read failure.
    if (profileError !== null) {
      log.warn('profile read failed; greeting uses the claim fallback', {
        error: profileError,
      });
    }
  }, [profileError]);
  const profileName =
    typeof profile?.displayName === 'string' && profile.displayName.trim() !== ''
      ? profile.displayName.trim()
      : null;
  return profileName ?? claimName;
}

export function DashboardHeader({ now = new Date() }: { now?: Date }) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const name = useGreetingName();
  const [nameSheetOpen, setNameSheetOpen] = useState(false);
  const privacyMode = useUiStore((s) => s.privacyMode);
  const revealed = useUiStore((s) => s.valuesRevealed);
  const toggleValuesRevealed = useUiStore((s) => s.toggleValuesRevealed);
  const reduced = useReducedMotion();
  const { hovered, hoverProps } = useHover();
  // Full first code point (Hangul/astral-safe), matching shell profileClaims.
  const firstChar = name === null ? undefined : Array.from(name)[0];
  const initial = firstChar === undefined ? null : firstChar.toLocaleUpperCase();

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.dim,
            fontSize: 13,
            fontFamily: theme.fonts.sansSet.semibold,
            marginBottom: 2,
          }}
        >
          {headerDateLine(localeTag(lang), now)}
        </Text>
        <Pressable
          onPress={() => setNameSheetOpen(true)}
          {...hoverProps}
          accessibilityRole="button"
          accessibilityLabel={t('Edit name')}
          accessibilityHint={t('Shown in your dashboard greeting')}
          testID="dash-greeting"
          style={[
            styles.greetingPress,
            hoverTransitionStyle(reduced),
            {
              borderRadius: theme.radius.control,
              backgroundColor: hovered ? hoverBackground(theme) : 'transparent',
            },
          ]}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              color: theme.colors.text,
              fontSize: theme.components.screenTitle.fontSize,
              letterSpacing: theme.components.screenTitle.letterSpacing,
              fontFamily: theme.fonts.display,
            }}
          >
            {greeting(lang, now.getHours(), name ?? undefined)}
          </Text>
        </Pressable>
      </View>
      {privacyMode ? (
        <Pressable
          onPress={toggleValuesRevealed}
          accessibilityRole="button"
          accessibilityLabel={revealed ? t('Hide amounts') : t('Show amounts')}
          testID="dash-privacy-eye"
          hitSlop={8}
          style={({ pressed }) => [
            styles.eye,
            { opacity: pressed ? 0.5 : 1 },
          ]}
        >
          {revealed ? (
            <Eye size={20} color={theme.colors.dim} strokeWidth={2} />
          ) : (
            <EyeOff size={20} color={theme.colors.dim} strokeWidth={2} />
          )}
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => router.push('/more')}
        accessibilityRole="button"
        accessibilityLabel={t('More')}
        testID="dash-avatar"
        style={({ pressed }) => [
          styles.avatar,
          {
            backgroundColor: theme.colors.accent,
            borderRadius: theme.radius.token,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          },
        ]}
      >
        {initial !== null ? (
          <Text
            style={{
              color: theme.colors.onAccent,
              fontSize: 16,
              fontFamily: theme.fonts.display,
            }}
          >
            {initial}
          </Text>
        ) : (
          <User size={18} color={theme.colors.onAccent} strokeWidth={2.2} />
        )}
      </Pressable>
      <GreetingNameSheet
        visible={nameSheetOpen}
        onClose={() => setNameSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  left: { flex: 1, marginRight: 12 },
  // Hover pill hugs the greeting without shifting the resting layout: the
  // padding is cancelled by equal negative margins.
  greetingPress: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginHorizontal: -6,
    marginVertical: -2,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eye: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
});
