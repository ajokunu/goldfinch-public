import ExpoModulesCore
import WidgetKit

// Local Expo module bridging the JS weekly-spend snapshot to the iOS App Group
// shared container the WidgetKit extension reads. Registered as "WidgetBridge"
// (see ../expo-module.config.json); app/features/widget/WidgetBridge.ts resolves
// it via requireOptionalNativeModule('WidgetBridge').
//
// The App Group + key MUST match the widget extension (targets/widget) and the
// app entitlement (app.config.ts ios.entitlements). A nil suite (App Group not
// provisioned on this build) makes the writes silent no-ops rather than crash.
public class WidgetBridgeModule: Module {
  private static let appGroup = "group.com.tabletales.goldfinch"
  private static let snapshotKey = "gf.widget.weeklySpend"

  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    // Write the snapshot JSON to the shared container and reload the widget
    // timelines so the new data shows promptly. Synchronous, matches the TS
    // interface (WidgetBridge.ts setWeeklySpendSnapshot(json: string): void).
    Function("setWeeklySpendSnapshot") { (json: String) in
      let defaults = UserDefaults(suiteName: WidgetBridgeModule.appGroup)
      defaults?.set(json, forKey: WidgetBridgeModule.snapshotKey)
      WidgetBridgeModule.reloadTimelines()
    }

    // Reload without a new write (used when only the "Show amounts on widget"
    // setting changed).
    Function("reloadWidgetTimelines") {
      WidgetBridgeModule.reloadTimelines()
    }
  }

  private static func reloadTimelines() {
    if #available(iOS 14.0, *) {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
