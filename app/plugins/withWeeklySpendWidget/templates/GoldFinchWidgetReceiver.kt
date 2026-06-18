package com.tabletales.goldfinch.widget

import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/**
 * AppWidget broadcast receiver wiring the GoldFinch weekly-spend Glance widget to
 * the Android home screen. Declared in AndroidManifest by the
 * withWeeklySpendWidget config plugin with the APPWIDGET_UPDATE intent filter +
 * the appwidget-provider meta-data (res/xml/goldfinch_widget_info.xml).
 *
 * The WidgetBridge native module (Kotlin side) requests an update by broadcasting
 * ACTION_APPWIDGET_UPDATE to this receiver after it writes the snapshot to the
 * shared SharedPreferences ("gf.widget" / "weeklySpend"); Glance then re-runs
 * provideGlance, which re-reads the prefs and re-renders.
 */
class GoldFinchWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = GoldFinchWidget()
}
