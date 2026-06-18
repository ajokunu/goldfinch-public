package com.tabletales.goldfinch.widget

import org.json.JSONObject

/**
 * Kotlin re-declaration of the WeeklySpendWidgetSnapshot contract (v1) that the
 * app's `app/features/widget/snapshot.ts` defines and writes. The app computes
 * everything (spend, percent, top-3, decimal strings); this Glance widget only
 * decodes + renders. Field names MUST match snapshot.ts exactly so the JSON the
 * WidgetBridge writes round-trips unchanged.
 *
 * Tolerant decode (org.json with opt* getters): a newer/older schemaVersion does
 * not break decode; nullable budget fields stay null on JSON null/absent; any
 * structural error yields null (the widget then shows its placeholder rather
 * than crashing the host launcher process).
 */
data class WeeklySpendWidgetSnapshot(
    val schemaVersion: Int,
    val generatedAt: String,
    /** Monday of the window (yyyy-mm-dd, America/New_York). Never "Sun-Sat". */
    val weekStart: String,
    /** Sunday of the window (yyyy-mm-dd). Range is ALWAYS Mon..Sun, 7 days. */
    val weekEnd: String,
    val currency: String,
    /** Persisted "Show amounts on widget" flag; false -> render amount-less. */
    val showAmounts: Boolean,
    val spentMinor: Long,
    /** Lossless decimal-string rendering of spentMinor (e.g. "42.50"). */
    val spent: String,
    /** Null when no weekly budget exists; both budget fields null together. */
    val budgetMinor: Long?,
    val budget: String?,
    /** Integer percent (>= 0, MAY exceed 100); null when no weekly budget. */
    val percentOfBudget: Int?,
    /** Top 3 spend categories, descending; <= 3 rows (medium layout). */
    val topCategories: List<WidgetTopCategory>,
) {
    companion object {
        /** Shared-container key the WidgetBridge writes and this widget reads. */
        const val PREFS_NAME = "gf.widget"
        const val PREFS_KEY = "weeklySpend"

        /**
         * Tolerant decode of the snapshot JSON string. Returns null on any
         * structural failure so the caller can render a safe placeholder instead
         * of crashing. Nullable budget fields preserve JSON null / absence.
         */
        fun fromJson(json: String?): WeeklySpendWidgetSnapshot? {
            if (json.isNullOrBlank()) return null
            return try {
                val obj = JSONObject(json)
                WeeklySpendWidgetSnapshot(
                    schemaVersion = obj.optInt("schemaVersion", 1),
                    generatedAt = obj.optString("generatedAt", ""),
                    weekStart = obj.optString("weekStart", ""),
                    weekEnd = obj.optString("weekEnd", ""),
                    currency = obj.optString("currency", "USD"),
                    showAmounts = obj.optBoolean("showAmounts", true),
                    spentMinor = obj.optLong("spentMinor", 0L),
                    spent = obj.optString("spent", "0.00"),
                    budgetMinor = if (obj.isNull("budgetMinor")) null else obj.optLong("budgetMinor"),
                    budget = if (obj.isNull("budget")) null else obj.optString("budget"),
                    percentOfBudget = if (obj.isNull("percentOfBudget")) null else obj.optInt("percentOfBudget"),
                    topCategories = parseCategories(obj.optJSONArray("topCategories")),
                )
            } catch (error: Throwable) {
                null
            }
        }

        private fun parseCategories(array: org.json.JSONArray?): List<WidgetTopCategory> {
            if (array == null) return emptyList()
            val out = ArrayList<WidgetTopCategory>(array.length())
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                out.add(
                    WidgetTopCategory(
                        categoryId = item.optString("categoryId", ""),
                        name = item.optString("name", ""),
                        iconKey = item.optString("iconKey", ""),
                        color = item.optString("color", ""),
                        spentMinor = item.optLong("spentMinor", 0L),
                        spent = item.optString("spent", "0.00"),
                    ),
                )
            }
            return out
        }
    }
}

/**
 * One top-spend category row (<= 3 per snapshot). `categoryId`/`iconKey` are ""
 * for the uncategorized bucket; `color` is a baked hex string (e.g. "#FF6B6B")
 * the widget parses directly (no live-theme lookup in the sandboxed widget).
 */
data class WidgetTopCategory(
    val categoryId: String,
    val name: String,
    val iconKey: String,
    val color: String,
    val spentMinor: Long,
    val spent: String,
)
