/**
 * Bottom-sheet modal scaffold shared across features (components.md 4.3 +
 * section 7): grab handle, optional title header with circle close control,
 * scrollable body, optional pinned footer, keyboard avoidance on iOS.
 *
 * Sheet motion (7.2): the panel slides from 110% with `motion.sheet` while
 * the backdrop fades with `motion.backdrop`; the entry starts only after the
 * first frame commits (double-rAF) so the slide is never skipped. On close
 * the LAST content stays rendered while the panel animates out (cached exit
 * -- content must not blank during the exit), then the Modal unmounts.
 * Android hardware back and backdrop press both close. Reduced motion
 * collapses every duration to ~1ms.
 *
 * API is source-compatible with the previous ModalSheet: `title` became
 * optional (headerless sheets); `footer` / `maxHeightFraction` are additive.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from './IconButton';
import { Stagger, stagger as staggerTokens } from './motion';
import { useTheme } from './ThemeProvider';
import { motionDuration, useReducedMotion } from './useReducedMotion';

export interface ModalSheetProps {
  visible: boolean;
  /** Optional since the restyle; sheets without a title are headerless. */
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned action row below the scroll body (Buttons with caller-set flex). */
  footer?: ReactNode;
  /** Fraction of the window height the panel may use. Default 0.86. */
  maxHeightFraction?: number;
}

interface CachedContent {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}

// The upward panel shadow is a spec'd component constant
// (tokens.md section 4, sheet panel), not a theme color. Android cannot
// render upward elevation -- accepted drop.
const PANEL_SHADOW: ViewStyle = Platform.select<ViewStyle>({
  web: { boxShadow: '0 -20px 50px -20px rgba(0, 0, 0, 0.4)' },
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -20 },
    shadowOpacity: 0.4,
    shadowRadius: 25,
  },
  default: {},
});

export function ModalSheet({
  visible,
  title,
  onClose,
  children,
  footer,
  maxHeightFraction = 0.86,
}: ModalSheetProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(visible);
  const setMountedBoth = useCallback((value: boolean) => {
    mountedRef.current = value;
    setMounted(value);
  }, []);

  const [panelHeight, setPanelHeight] = useState(0);
  const panelProgress = useRef(new Animated.Value(0)).current;
  const backdropProgress = useRef(new Animated.Value(0)).current;
  const frameIds = useRef<number[]>([]);

  // Cached exit content (7.2): while the sheet animates out, the last
  // visible title/body/footer keep rendering.
  const contentRef = useRef<CachedContent>({ title, children, footer });
  useEffect(() => {
    if (visible) contentRef.current = { title, children, footer };
  });
  const content: CachedContent = visible
    ? { title, children, footer }
    : contentRef.current;

  const cancelFrames = useCallback(() => {
    for (const id of frameIds.current) cancelAnimationFrame(id);
    frameIds.current = [];
  }, []);

  useEffect(() => {
    const animateTo = (toValue: number, onDone?: () => void) => {
      Animated.parallel([
        Animated.timing(panelProgress, {
          toValue,
          duration: motionDuration(theme.motion.sheet.durationMs, reduced),
          easing: Easing.bezier(...theme.motion.sheet.bezier),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(backdropProgress, {
          toValue,
          duration: motionDuration(theme.motion.backdrop.durationMs, reduced),
          easing: Easing.bezier(...theme.motion.backdrop.bezier),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start(({ finished }) => {
        if (finished) onDone?.();
      });
    };

    if (visible) {
      setMountedBoth(true);
      cancelFrames();
      // Double-rAF: start the slide only after the first frame commits so
      // the entry animation is never skipped (7.2).
      const outer = requestAnimationFrame(() => {
        const inner = requestAnimationFrame(() => animateTo(1));
        frameIds.current.push(inner);
      });
      frameIds.current.push(outer);
    } else if (mountedRef.current) {
      cancelFrames();
      animateTo(0, () => setMountedBoth(false));
    }
    return cancelFrames;
  }, [
    visible,
    reduced,
    theme,
    panelProgress,
    backdropProgress,
    cancelFrames,
    setMountedBoth,
  ]);

  // Stop in-flight animations when the owner unmounts the sheet entirely.
  useEffect(
    () => () => {
      panelProgress.stopAnimation();
      backdropProgress.stopAnimation();
    },
    [panelProgress, backdropProgress],
  );

  if (!visible && !mounted) return null;

  const offscreen = Math.max(1, Math.round((panelHeight || windowHeight) * 1.1));
  const translateY = panelProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [offscreen, 0],
  });

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: theme.colors.scrim, opacity: backdropProgress },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={onClose}
            disabled={!visible}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
          style={styles.avoider}
        >
          <Animated.View
            onLayout={(event) => {
              const next = Math.round(event.nativeEvent.layout.height);
              setPanelHeight((prev) => (prev === next ? prev : next));
            }}
            style={[
              styles.panel,
              PANEL_SHADOW,
              {
                // Yoga cannot resolve a % maxHeight against an auto-height
                // parent, so the cap is computed from the window.
                maxHeight: Math.round(windowHeight * maxHeightFraction),
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: theme.radius.sheet,
                borderTopRightRadius: theme.radius.sheet,
                borderColor: theme.colors.border,
                transform: [{ translateY }],
              },
            ]}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[styles.handle, { backgroundColor: theme.colors.border }]}
            />
            {content.title !== undefined ? (
              <View style={styles.header}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.title,
                    {
                      color: theme.colors.textPrimary,
                      fontFamily: theme.fonts.display,
                      fontWeight: theme.fonts.displayWeight,
                    },
                  ]}
                >
                  {content.title}
                </Text>
                <IconButton
                  icon={X}
                  onPress={onClose}
                  accessibilityLabel="Close"
                  variant="circle"
                  iconSize={20}
                />
              </View>
            ) : null}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingTop: 4,
                paddingHorizontal: 20,
                paddingBottom: content.footer ? 20 : 20 + insets.bottom,
              }}
              style={styles.body}
            >
              {/* Sheet content stagger (PHASE9-DECISIONS P9-2 item 9): body
                  content FadeRises in 60ms behind the panel slide, each
                  direct child a further 60ms apart. Mount-only, so the
                  cached-exit content never replays while animating out, and
                  reduced motion collapses to simultaneous fast fades. */}
              <Stagger
                intervalMs={staggerTokens.sheetMs}
                initialDelayMs={staggerTokens.sheetMs}
              >
                {content.children}
              </Stagger>
            </ScrollView>
            {content.footer ? (
              <View
                style={[
                  styles.footer,
                  {
                    borderTopColor: theme.colors.line,
                    paddingBottom: insets.bottom + 22,
                  },
                ]}
              >
                {content.footer}
              </View>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  avoider: { justifyContent: 'flex-end' },
  panel: { borderTopWidth: 1, paddingTop: 8 },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 3,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: { flex: 1, fontSize: 19 },
  body: { flexGrow: 0 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
  },
});
