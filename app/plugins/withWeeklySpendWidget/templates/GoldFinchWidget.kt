package com.goldfinch.app.widget

import android.content.Context
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.color.ColorProvider as DayNightColorProvider
import androidx.glance.background
import androidx.glance.unit.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider as UnitColorProvider

/**
 * GoldFinch weekly-spend home-screen widget (Jetpack Glance / Compose).
 *
 * Reads the snapshot the WidgetBridge wrote to SharedPreferences ("gf.widget" /
 * "weeklySpend"), decodes it tolerantly, and renders one of two layouts:
 *
 *  - small  : "This week" + spend total (if showAmounts) + budget bar + percent.
 *  - medium : the small layout + the top 3 spend categories (colored dot + name
 *             + amount when showAmounts).
 *
 * showAmounts == false hides every currency figure but keeps the period header
 * and the budget progress bar (a privacy-preserving amount-less variant).
 *
 * The widget owns NO finance math: spend, percent, decimal strings, and the
 * top-3 selection are all final values from the snapshot. The bar fill clamps to
 * [0, 100] for layout; the percent LABEL shows the true value (may exceed 100).
 *
 * Tapping anywhere opens goldfinch:// (the dashboard golden root) via a
 * PendingIntent (actionStartActivity + an explicit-package ACTION_VIEW intent).
 *
 * Theming: the sandboxed widget cannot read the app's live 4-direction theme, so
 * a FIXED brand palette is used with system light/dark via day/night
 * ColorProviders.
 */
class GoldFinchWidget : GlanceAppWidget() {

    // Responsive: the host picks SMALL_SQUARE vs HORIZONTAL_RECTANGLE; the
    // composable branches on the resolved size (height threshold) so a single
    // widget covers both the small and medium families.
    override val sizeMode: SizeMode = SizeMode.Responsive(
        setOf(SMALL_SQUARE, HORIZONTAL_RECTANGLE),
    )

    override suspend fun provideGlance(context: Context, id: androidx.glance.GlanceId) {
        val snapshot = loadSnapshot(context)
        provideContent {
            GlanceTheme {
                WidgetRoot(snapshot)
            }
        }
    }

    /** Read + tolerantly decode the snapshot from the shared SharedPreferences. */
    private fun loadSnapshot(context: Context): WeeklySpendWidgetSnapshot? {
        val prefs = context.getSharedPreferences(
            WeeklySpendWidgetSnapshot.PREFS_NAME,
            Context.MODE_PRIVATE,
        )
        return WeeklySpendWidgetSnapshot.fromJson(
            prefs.getString(WeeklySpendWidgetSnapshot.PREFS_KEY, null),
        )
    }

    companion object {
        // Glance size buckets; the medium layout is shown for the wider tile.
        val SMALL_SQUARE = DpSize(110.dp, 110.dp)
        val HORIZONTAL_RECTANGLE = DpSize(250.dp, 110.dp)
    }
}

// --- Fixed brand palette (day / night), mirrors the iOS widget exactly. -------

private val BackgroundColor = ColorProviderDayNight(0xFFFFFFFF, 0xFF111827)
private val TextPrimary = ColorProviderDayNight(0xFF1F2937, 0xFFF3F4F6)
private val TextSecondary = ColorProviderDayNight(0xFF6B7280, 0xFF9CA3AF)
private val BarTrack = ColorProviderDayNight(0xFFE5E7EB, 0xFF374151)
private val BarGreen = ColorProviderDayNight(0xFF10B981, 0xFF059669)
private val BarAmber = ColorProviderDayNight(0xFFF59E0B, 0xFFD97706)
private val BarRed = ColorProviderDayNight(0xFFEF4444, 0xFFDC2626)

private fun ColorProviderDayNight(day: Long, night: Long): ColorProvider =
    DayNightColorProvider(day = Color(day), night = Color(night))

/**
 * Budget-bar color, identical to the iOS widget: green at or under 80%, amber up
 * to 100%, red above 100%. `percent` is the TRUE percent (may exceed 100).
 */
private fun budgetBarColor(percent: Int): ColorProvider = when {
    percent <= 80 -> BarGreen
    percent <= 100 -> BarAmber
    else -> BarRed
}

/** Deep link to the dashboard golden root; explicit package so it always lands. */
private fun dashboardClickModifier(): GlanceModifier {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("goldfinch://")).apply {
        setPackage("com.goldfinch.app")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return GlanceModifier.clickable(actionStartActivity(intent))
}

// --- Layout -------------------------------------------------------------------

@Composable
private fun WidgetRoot(snapshot: WeeklySpendWidgetSnapshot?) {
    val isMedium = androidx.glance.LocalSize.current.height < 100.dp ||
        androidx.glance.LocalSize.current.width >= 180.dp
    Box(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(BackgroundColor)
            .cornerRadius(16.dp)
            .padding(14.dp)
            .then(dashboardClickModifier()),
    ) {
        if (snapshot == null) {
            PlaceholderContent()
        } else if (isMedium) {
            MediumContent(snapshot)
        } else {
            SmallContent(snapshot)
        }
    }
}

/** Shown when no snapshot has been written yet (or a decode failure). */
@Composable
private fun PlaceholderContent() {
    Column {
        PeriodHeader()
        Spacer(GlanceModifier.height(6.dp))
        Text(
            text = "No data yet",
            style = TextStyle(color = TextSecondary, fontSize = 13.sp),
        )
    }
}

@Composable
private fun PeriodHeader() {
    Text(
        text = "This week",
        style = TextStyle(
            color = TextSecondary,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        ),
    )
}

@Composable
private fun SmallContent(snapshot: WeeklySpendWidgetSnapshot) {
    Column(modifier = GlanceModifier.fillMaxSize()) {
        PeriodHeader()
        Spacer(GlanceModifier.height(6.dp))
        if (snapshot.showAmounts) {
            Text(
                text = currencyLabel(snapshot.spent, snapshot.currency),
                style = TextStyle(
                    color = TextPrimary,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Bold,
                ),
            )
        }
        if (snapshot.budgetMinor != null && snapshot.percentOfBudget != null) {
            Spacer(GlanceModifier.height(8.dp))
            BudgetBar(snapshot.percentOfBudget)
            Spacer(GlanceModifier.height(4.dp))
            Text(
                text = "${snapshot.percentOfBudget}% of budget",
                style = TextStyle(color = TextSecondary, fontSize = 12.sp),
            )
        }
    }
}

@Composable
private fun MediumContent(snapshot: WeeklySpendWidgetSnapshot) {
    Row(modifier = GlanceModifier.fillMaxSize()) {
        Column(modifier = GlanceModifier.defaultWeight()) {
            SmallContent(snapshot)
        }
        Spacer(GlanceModifier.width(12.dp))
        Column(modifier = GlanceModifier.defaultWeight()) {
            Text(
                text = "Top categories",
                style = TextStyle(
                    color = TextSecondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
            Spacer(GlanceModifier.height(6.dp))
            if (snapshot.topCategories.isEmpty()) {
                Text(
                    text = "No spending",
                    style = TextStyle(color = TextSecondary, fontSize = 12.sp),
                )
            } else {
                snapshot.topCategories.forEach { category ->
                    CategoryRow(category, snapshot.showAmounts, snapshot.currency)
                    Spacer(GlanceModifier.height(4.dp))
                }
            }
        }
    }
}

@Composable
private fun CategoryRow(category: WidgetTopCategory, showAmounts: Boolean, currency: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        ColorDot(category.color)
        Spacer(GlanceModifier.width(6.dp))
        Box(modifier = GlanceModifier.defaultWeight()) {
            Text(
                text = category.name,
                maxLines = 1,
                style = TextStyle(color = TextPrimary, fontSize = 13.sp),
            )
        }
        if (showAmounts) {
            Spacer(GlanceModifier.width(6.dp))
            Text(
                text = currencyLabel(category.spent, currency),
                maxLines = 1,
                style = TextStyle(
                    color = TextSecondary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
        }
    }
}

/** Small colored dot from the snapshot's baked hex; falls back to secondary. */
@Composable
private fun ColorDot(hex: String) {
    val parsed = parseHexColor(hex)
    val provider = if (parsed != null) UnitColorProvider(parsed) else TextSecondary
    Box(
        modifier = GlanceModifier
            .width(10.dp)
            .height(10.dp)
            .cornerRadius(5.dp)
            .background(provider),
    ) {}
}

/** Budget progress bar: fill clamped to [0, 100]; color from budgetBarColor. */
@Composable
private fun BudgetBar(percent: Int) {
    val clamped = percent.coerceIn(0, 100)
    val fillColor = budgetBarColor(percent)
    Box(
        modifier = GlanceModifier
            .fillMaxWidth()
            .height(8.dp)
            .cornerRadius(4.dp)
            .background(BarTrack),
    ) {
        // Approximate the fill with a fractional-width box. Glance has no native
        // progress primitive in a Box overlay, so weight columns model the split.
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            if (clamped > 0) {
                Box(
                    modifier = GlanceModifier
                        .defaultWeight()
                        .height(8.dp)
                        .cornerRadius(4.dp)
                        .background(fillColor),
                ) {}
            }
            if (clamped < 100) {
                Spacer(modifier = GlanceModifier.defaultWeight())
            }
        }
    }
}

// --- Helpers ------------------------------------------------------------------

/**
 * Currency label from the snapshot's lossless decimal string. The snapshot does
 * NOT carry a symbol; USD gets a "$" prefix, everything else gets the ISO code
 * suffix (e.g. "12.00 EUR"). No math here -- `decimal` is rendered verbatim.
 */
private fun currencyLabel(decimal: String, currency: String): String =
    if (currency == "USD") "$$decimal" else "$decimal $currency"

/** Parse "#RRGGBB" / "#AARRGGBB" to a Compose Color; null on any failure. */
private fun parseHexColor(hex: String): Color? = try {
    if (hex.isBlank()) null else Color(AndroidColor.parseColor(hex))
} catch (error: IllegalArgumentException) {
    null
}
