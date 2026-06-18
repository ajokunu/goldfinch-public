/**
 * View-snapshot capture for the theme crossfade -- WEB / FALLBACK LEG.
 *
 * Platform-split contract (resolved by Metro/Jest platform extensions):
 * - themeSnapshot.native.ts captures real pixels via Skia makeImageFromView.
 * - this file is what web bundles (and the TypeScript program) resolve; the
 *   web theme crossfade uses a document-level CSS palette transition instead
 *   of pixel snapshots, so this leg must never be reached in production. It
 *   returns null (the caller's sanctioned "switch without crossfade" path)
 *   and logs, never throws.
 *
 * Keeping the Skia import out of this file keeps @shopify/react-native-skia
 * (and its CanvasKit wasm) out of the web bundle graph entirely.
 */
import type { RefObject } from 'react';
import type { View } from 'react-native';

import { logger } from '../../lib/logger';

const log = logger.child({ component: 'themeSnapshot' });

/**
 * The single cross-platform capture signature; themeSnapshot.native.ts
 * imports this type so the two legs cannot drift.
 */
export type CaptureViewSnapshot = (
  viewRef: RefObject<View | null>,
) => Promise<string | null>;

/** Web/fallback leg: no pixel capture; callers swap themes instantly. */
export const captureViewSnapshot: CaptureViewSnapshot = (_viewRef) => {
  log.warn(
    'captureViewSnapshot reached the non-native leg; theme will swap without a crossfade overlay',
  );
  return Promise.resolve(null);
};
