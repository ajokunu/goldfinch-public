/**
 * Confirmation toast for the categorize / teach-a-rule flows (screens.md
 * 0.6 / shell.md 2.4 anatomy), feature-hosted until the shell-level
 * ToastHost ships: icon tile + title + optional sub, bottom-anchored inside
 * the screen, auto-dismissing after ~2.8s. Re-firing (a new `id`) resets
 * the timer and replays the entrance (the FadeRise is keyed by fire id).
 * Announced via AccessibilityInfo.announceForAccessibility; the slide/fade
 * entrance is the shared FadeRise primitive (PHASE9-DECISIONS P9-1: no
 * ad-hoc Animated code in features; reduced motion collapses to a fast
 * fade inside the primitive).
 */
import { useEffect, type ComponentType } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';

import { CheckDraw, FadeRise } from '../../../src/ui/motion';
import { shadowStyle } from '../../../src/ui/shadows';
import { useTheme } from '../../../src/ui/ThemeProvider';

const TOAST_DURATION_MS = 2800;
const ENTER_MS = 220;
/** Entrance travel in dp (the prototype's 20px bottom slide). */
const ENTER_RISE = 20;

export interface ToastData {
  /** New id per fire; a repeat fire resets the dismiss timer. */
  id: number;
  icon: ComponentType<LucideProps>;
  title: string;
  sub?: string;
  /**
   * Success checkmark draw-on (PHASE9-DECISIONS P9-2 item 7): replaces the
   * static icon with the animated CheckDraw after a categorize/save lands.
   * `icon` stays required as the semantic fallback.
   */
  drawCheck?: boolean;
}

export interface ToastProps {
  toast: ToastData | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const theme = useTheme();

  useEffect(() => {
    if (!toast) return undefined;
    AccessibilityInfo.announceForAccessibility(
      toast.sub ? `${toast.title}. ${toast.sub}` : toast.title,
    );
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  const IconComponent = toast.icon;

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={styles.host}
    >
      {/* Keyed by fire id: a re-fire remounts the FadeRise and replays the
          slide/fade entrance (FadeRise is mount-only by design). */}
      <FadeRise
        key={toast.id}
        durationMs={ENTER_MS}
        distance={ENTER_RISE}
        style={[
          styles.card,
          shadowStyle(theme.colors.shadow),
          {
            backgroundColor: theme.colors.elev,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.card,
          },
        ]}
      >
        <View
          style={[styles.iconTile, { backgroundColor: theme.colors.accent }]}
        >
          {toast.drawCheck === true ? (
            // Keyed by fire id so a re-fire draws the check on again.
            <CheckDraw
              key={toast.id}
              size={16}
              color={theme.colors.onAccent}
              testID="toast-check-draw"
            />
          ) : (
            <IconComponent
              size={16}
              strokeWidth={2.3}
              color={theme.colors.onAccent}
            />
          )}
        </View>
        <View style={styles.textCol}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 13,
              fontWeight: '700',
              fontFamily: theme.fonts.sans,
            }}
            numberOfLines={1}
          >
            {toast.title}
          </Text>
          {toast.sub ? (
            <Text
              style={{
                color: theme.colors.dim,
                fontSize: 11.5,
                fontFamily: theme.fonts.sans,
              }}
              numberOfLines={1}
            >
              {toast.sub}
            </Text>
          ) : null}
        </View>
      </FadeRise>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    padding: 12,
  },
  iconTile: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textCol: { flex: 1, gap: 1 },
});
