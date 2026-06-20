/**
 * @bacons/apple-targets config for the GoldFinch home-screen widget
 * (WIDGET-PLAN.md task 5 — the iOS SwiftUI/WidgetKit extension).
 *
 * This declares a WidgetKit extension target that the `@bacons/apple-targets`
 * config plugin adds to the prebuilt Xcode project. The `.swift` sources live
 * FLAT at this target-dir root (the canonical apple-targets layout, e.g.
 * targets/widget/index.swift in the upstream examples) and are linked into the
 * extension via an Xcode synchronized root group; the `Info.plist` and
 * `widget.entitlements` in this directory are used verbatim (the root plist of
 * a target dir is not managed by the plugin, so we own them).
 *
 * FROZEN CONTRACT (must match the bridge + app + snapshot.ts exactly):
 * - App Group: group.com.goldfinch.app (also on the app target, set in
 *   app.config.ts ios.entitlements). The bridge WRITES, this widget READS the
 *   same UserDefaults suite, key "gf.widget.weeklySpend".
 * - Deep link scheme: goldfinch:// (app.config.ts `scheme`).
 *
 * The plugin mirrors the App Group from the app config when present; we also
 * declare it here so the entitlement is explicit on the extension target (its
 * absence is the #1 cause of an iOS widget showing "No data").
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',
  name: 'GoldFinchWidget',
  displayName: 'GoldFinch Widget',
  // Widget runs SwiftUI/WidgetKit; 17.0 is a safe modern floor (WidgetKit is
  // iOS 14+, the SwiftUI APIs used here are 14/16-era). Kept below the app's
  // own min so the extension never demands a newer OS than the host app.
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
  entitlements: {
    'com.apple.security.application-groups': ['group.com.goldfinch.app'],
  },
};
