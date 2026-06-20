/**
 * JS -> native bridge for the home-screen weekly-spend widget (WIDGET-PLAN.md
 * task 4 / 6). The native side (iOS Swift + Android Kotlin, a later device-build
 * follow-up) registers an Expo module named "WidgetBridge" that writes the
 * snapshot JSON into the shared container (iOS App Group UserDefaults / Android
 * SharedPreferences) and reloads the widget timeline. This file is the TS
 * INTERFACE the app calls; the native implementation does not exist yet.
 *
 * Safe no-op fallback: the native module is absent in every environment that
 * matters here -- the JS-only/Expo Go build, web, and all unit tests. We resolve
 * it through `requireOptionalNativeModule`, which returns `null` (rather than
 * throwing, as `requireNativeModule` would) when no module is registered. So
 * importing this file never throws, and `setWeeklySpendSnapshot` becomes a
 * logged no-op until the native target ships. That keeps the refresh hook
 * harmless on every platform before the device build lands.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

import { logger } from '../../src/lib/logger';

/**
 * The native module surface this bridge expects. Both methods are optional on
 * the resolved object so a partial/older native build (e.g. one without
 * `reloadWidgetTimelines`) degrades to a no-op rather than a crash. The native
 * impls return void synchronously after writing the shared container.
 */
interface WidgetBridgeNativeModule {
  setWeeklySpendSnapshot?(json: string): void;
  /** iOS-only timeline reload without a new write; Android stubs to void. */
  reloadWidgetTimelines?(): void;
}

const log = logger.child({ feature: 'widget-bridge' });

/**
 * The native module, or null when it is not registered (the only case in this
 * environment until the native target ships). Resolved once at import; the
 * optional variant never throws on absence.
 */
const nativeModule =
  requireOptionalNativeModule<WidgetBridgeNativeModule>('WidgetBridge');

/** True only on a device build that actually registered the native module. */
export function isWidgetBridgeAvailable(): boolean {
  return nativeModule !== null && nativeModule !== undefined;
}

/**
 * Write the weekly-spend snapshot JSON to the shared container and reload the
 * widget timeline. Synchronous, fire-and-forget: the caller (useWidgetSync)
 * builds the snapshot and hands the stringified JSON here on each refresh
 * trigger. When the native module is absent (JS-only build, web, tests) this is
 * a debug-logged no-op so nothing downstream has to branch on availability.
 *
 * Never throws: a native-side failure is caught and logged so a bad widget
 * write can never break a foreground/sync refresh in the app itself.
 */
export function setWeeklySpendSnapshot(json: string): void {
  if (nativeModule?.setWeeklySpendSnapshot === undefined) {
    log.debug('WidgetBridge native module absent; skipping snapshot write');
    return;
  }
  try {
    nativeModule.setWeeklySpendSnapshot(json);
  } catch (error) {
    log.warn('WidgetBridge.setWeeklySpendSnapshot failed', { error });
  }
}

/**
 * Reload the widget timelines without writing a new snapshot (iOS uses this when
 * only the persisted "Show amounts on widget" setting changed; Android stubs it
 * to void). No-op when the native module or the method is absent. Never throws.
 */
export function reloadWidgetTimelines(): void {
  if (nativeModule?.reloadWidgetTimelines === undefined) {
    log.debug('WidgetBridge native module absent; skipping timeline reload');
    return;
  }
  try {
    nativeModule.reloadWidgetTimelines();
  } catch (error) {
    log.warn('WidgetBridge.reloadWidgetTimelines failed', { error });
  }
}
