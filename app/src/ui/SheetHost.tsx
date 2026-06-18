/**
 * Shell-level sheet host (components.md section 7): one provider mounted in
 * the authenticated layout renders exactly one ModalSheet for shell-owned
 * sheets (add menu, and any sheet that must push the app layer back).
 * Feature modals may keep mounting their own ModalSheet locally -- the
 * visuals are identical because they share the restyled component.
 *
 * Cached exit (7.2, host side): when the sheet state goes null, the host
 * keeps rendering the LAST sheet's title/body/footer while the panel
 * animates out, so content never blanks mid-exit.
 *
 * Background push (7.4): while a host sheet is open, the app layer scales to
 * 0.92, translates 14px (top-center origin, emulated with a compensating
 * translate), rounds to 38px and dims under an 18% scrim-colored overlay --
 * the portable replacement for the prototype's brightness/saturate filter.
 * Phone layout only; wide web (>= 1024px) and reduced motion skip the push.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { ModalSheet } from './ModalSheet';
import { useTheme } from './ThemeProvider';
import { motionDuration, useReducedMotion } from './useReducedMotion';

export interface SheetContent {
  title?: string;
  body: ReactNode;
  /** Pinned action row (ModalSheet footer); Buttons with caller-set flex. */
  footer?: ReactNode;
  maxHeightFraction?: number;
}

export interface SheetController {
  open: (content: SheetContent) => void;
  close: () => void;
  isOpen: boolean;
}

const SheetContext = createContext<SheetController | null>(null);

const PUSH_SCALE = 0.92;
const PUSH_TRANSLATE = 14;
const PUSH_RADIUS = 38;
const PUSH_DIM_OPACITY = 0.18;

export function SheetHost({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();

  const [sheet, setSheet] = useState<SheetContent | null>(null);
  const lastSheetRef = useRef<SheetContent | null>(null);
  useEffect(() => {
    if (sheet) lastSheetRef.current = sheet;
  }, [sheet]);

  const open = useCallback((content: SheetContent) => setSheet(content), []);
  const close = useCallback(() => setSheet(null), []);
  const controller = useMemo<SheetController>(
    () => ({ open, close, isOpen: sheet !== null }),
    [open, close, sheet],
  );

  // Desktop sidebar layout (>= 1024px web) shows sheet + backdrop without
  // pushing the frame; reduced motion gets an instant scrim, no push.
  const pushEnabled =
    !reduced && !(Platform.OS === 'web' && windowWidth >= 1024);

  // JS driver: borderRadius and overlay opacity are not native-animatable
  // alongside the transform from one value.
  const pushProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(pushProgress, {
      toValue: sheet !== null && pushEnabled ? 1 : 0,
      duration: motionDuration(theme.motion.push.durationMs, reduced),
      easing: Easing.bezier(...theme.motion.push.bezier),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [sheet, pushEnabled, pushProgress, theme, reduced]);

  // RN scales from the center; shifting up by half the lost height keeps the
  // top edge anchored (the prototype's transform-origin: top center).
  const pushedTranslateY =
    PUSH_TRANSLATE - (windowHeight * (1 - PUSH_SCALE)) / 2;
  const scale = pushProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, PUSH_SCALE],
  });
  const translateY = pushProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, pushedTranslateY],
  });
  const borderRadius = pushProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, PUSH_RADIUS],
  });
  const dimOpacity = pushProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, PUSH_DIM_OPACITY],
  });

  // Cached exit: render the last sheet's content while animating out.
  const active = sheet ?? lastSheetRef.current;

  return (
    <SheetContext.Provider value={controller}>
      <View
        style={[styles.root, { backgroundColor: theme.colors.pushUnderlay }]}
      >
        <Animated.View
          style={[
            styles.appLayer,
            { borderRadius, transform: [{ translateY }, { scale }] },
          ]}
        >
          {children}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              {
                backgroundColor: theme.colors.pushUnderlay,
                opacity: dimOpacity,
              },
            ]}
          />
        </Animated.View>
        <ModalSheet
          visible={sheet !== null}
          title={active?.title}
          onClose={close}
          footer={active?.footer}
          maxHeightFraction={active?.maxHeightFraction}
        >
          {active?.body ?? null}
        </ModalSheet>
      </View>
    </SheetContext.Provider>
  );
}

export function useSheet(): SheetController {
  const controller = useContext(SheetContext);
  if (!controller) {
    throw new Error('useSheet must be used inside a SheetHost provider');
  }
  return controller;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appLayer: { flex: 1, overflow: 'hidden' },
});
