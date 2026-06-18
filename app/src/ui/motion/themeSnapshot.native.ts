/**
 * View-snapshot capture for the theme crossfade -- NATIVE LEG (iOS/Android).
 *
 * Captures the current pixels of the themed app container with Skia's
 * makeImageFromView (the only sanctioned graphics dependency besides
 * Reanimated/svg, P9-3) and returns them as a JPEG data URI that a plain
 * React Native <Image> can display. JPEG over PNG: the encode happens on the
 * JS thread during a Settings tap, and JPEG@80 is several times faster for a
 * full-screen capture with no visible difference under a 350ms fade.
 *
 * Skia is imported LAZILY inside the call:
 * - the module graph (ThemeProvider -> useThemeCrossfade -> here) loads in
 *   every environment, including Jest, where the Skia native bindings do not
 *   exist; nothing may touch them at module scope.
 * - a binary built without the Skia pod/aar degrades to a logged instant
 *   theme swap instead of crashing at startup (repo is live).
 *
 * Never throws: every failure path logs and resolves null, which callers
 * treat as "switch instantly without a crossfade overlay".
 */
import type { RefObject } from 'react';
import type { View } from 'react-native';

import { logger } from '../../lib/logger';
import type { CaptureViewSnapshot } from './themeSnapshot';

const log = logger.child({ component: 'themeSnapshot' });

/** JPEG quality for the transient overlay; invisible under a 350ms fade. */
const SNAPSHOT_JPEG_QUALITY = 80;

export const captureViewSnapshot: CaptureViewSnapshot = async (
  viewRef: RefObject<View | null>,
): Promise<string | null> => {
  if (viewRef.current === null) {
    log.warn('theme snapshot skipped: container ref not mounted');
    return null;
  }
  try {
    const skia = await import('@shopify/react-native-skia');
    const image = await skia.makeImageFromView(viewRef);
    if (image === null) {
      log.warn('makeImageFromView returned null; theme will swap instantly');
      return null;
    }
    try {
      const base64 = image.encodeToBase64(
        skia.ImageFormat.JPEG,
        SNAPSHOT_JPEG_QUALITY,
      );
      return `data:image/jpeg;base64,${base64}`;
    } finally {
      image.dispose();
    }
  } catch (error) {
    log.error('theme snapshot capture failed; theme will swap instantly', {
      error,
    });
    return null;
  }
};
