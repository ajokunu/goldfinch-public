package com.tabletales.goldfinch.widgetbridge

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Local Expo module bridging the JS weekly-spend snapshot to the Android
// SharedPreferences the Glance widget reads. Registered as "WidgetBridge" (see
// ../../../../../../expo-module.config.json); app/features/widget/WidgetBridge.ts
// resolves it via requireOptionalNativeModule('WidgetBridge').
//
// The prefs name + key MUST match the Glance widget the config plugin installs
// (plugins/withWeeklySpendWidget). RECEIVER_CLASS is referenced by name (not a
// compile-time type) so this module needs no dependency on the app package where
// the plugin places GoldFinchWidgetReceiver.
class WidgetBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetBridge")

    Function("setWeeklySpendSnapshot") { json: String ->
      // No bare `return@Function`: the Expo Function DSL types the body as
      // () -> Any?, and a bare return (Unit) mismatches. Guard with `if` instead.
      val context = appContext.reactContext
      if (context != null) {
        context
          .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
          .edit()
          .putString(SNAPSHOT_KEY, json)
          .apply()
        requestWidgetUpdate(context)
      }
    }

    Function("reloadWidgetTimelines") {
      val context = appContext.reactContext
      if (context != null) {
        requestWidgetUpdate(context)
      }
    }
  }

  // Ask the Glance receiver to refresh now. Glance also re-reads SharedPreferences
  // on its own update cadence, so a missed broadcast only delays (never loses) the
  // update.
  private fun requestWidgetUpdate(context: Context) {
    val component = ComponentName(context.packageName, RECEIVER_CLASS)
    val manager = AppWidgetManager.getInstance(context)
    val ids = manager.getAppWidgetIds(component)
    if (ids.isEmpty()) return
    val intent =
      Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
        component?.let { setComponent(it) }
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      }
    context.sendBroadcast(intent)
  }

  companion object {
    private const val PREFS_NAME = "gf.widget"
    private const val SNAPSHOT_KEY = "weeklySpend"
    // Must match the GlanceAppWidgetReceiver the config plugin installs.
    private const val RECEIVER_CLASS = "com.tabletales.goldfinch.widget.GoldFinchWidgetReceiver"
  }
}
