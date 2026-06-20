// GoldFinch home-screen widget — iOS SwiftUI / WidgetKit extension
// (WIDGET-PLAN.md task 5). Pure presentation: it decodes the FINAL snapshot the
// app wrote to the shared App Group container and renders it. It NEVER re-derives
// spend/budget math (the JS pure builder already did that; see
// app/features/widget/snapshot.ts).
//
// FROZEN CROSS-COMPONENT CONTRACT (must match the bridge, the app, and
// snapshot.ts exactly — drift here is the highest risk):
//   - App Group suite:   group.com.goldfinch.app
//   - Shared key:        gf.widget.weeklySpend
//   - Deep link:         goldfinch://  (opens the app's dashboard / golden root)
//   - JSON field names:  schemaVersion, generatedAt, weekStart, weekEnd,
//                        currency, showAmounts, spentMinor, spent, budgetMinor,
//                        budget, percentOfBudget,
//                        topCategories[{categoryId,name,iconKey,color,
//                                       spentMinor,spent}]
//   - Week bounds:       weekStart is MONDAY, weekEnd is SUNDAY (Mon..Sun ISO).
//                        NEVER hard-code "Sun-Sat"; render the dates from the
//                        snapshot. A newer/older schemaVersion degrades
//                        gracefully (we render whatever fields decoded).
//
// House rule: no emoji anywhere; plain text labels + colored dots only.

import WidgetKit
import SwiftUI

// MARK: - Frozen contract constants

private enum WidgetContract {
  static let appGroup = "group.com.goldfinch.app"
  static let snapshotKey = "gf.widget.weeklySpend"
  static let deepLink = "goldfinch://"
}

// MARK: - Snapshot Codable (mirrors app/features/widget/snapshot.ts exactly)

/// One top-spend category row (<= 3 per snapshot). Field names match
/// `WidgetTopCategory` in snapshot.ts.
struct WidgetTopCategory: Codable, Hashable {
  let categoryId: String
  let name: String
  let iconKey: String
  /// Presentation hex color, e.g. "#FF6B6B". Empty/garbage tolerated by the
  /// Color(hex:) parser (falls back to a neutral dot).
  let color: String
  let spentMinor: Int
  /// Lossless decimal-string rendering of spentMinor (e.g. "12.34").
  let spent: String
}

/// Weekly-spend snapshot (v1). Mirrors `WeeklySpendWidgetSnapshot` in
/// snapshot.ts. `budgetMinor` / `budget` / `percentOfBudget` may be null when no
/// weekly budget exists. Unknown future fields are ignored by Codable, so a
/// newer schemaVersion decodes the v1 subset gracefully; missing optionals stay
/// nil so an older writer also decodes.
struct WeeklySpendWidgetSnapshot: Codable {
  let schemaVersion: Int
  let generatedAt: String
  /// MONDAY, yyyy-mm-dd. (snapshot.ts: never "Sun-Sat".)
  let weekStart: String
  /// SUNDAY, yyyy-mm-dd.
  let weekEnd: String
  let currency: String
  /// "Show amounts on widget" setting; false => render the amount-less variant.
  let showAmounts: Bool
  let spentMinor: Int
  /// Lossless decimal-string rendering of spentMinor.
  let spent: String
  let budgetMinor: Int?
  let budget: String?
  /// Integer percent of weekly budget, >= 0, MAY exceed 100; nil when no budget.
  let percentOfBudget: Int?
  let topCategories: [WidgetTopCategory]

  /// Decode tolerantly from the shared App Group container. Returns nil on a
  /// missing key or undecodable payload so the view can show a neutral
  /// placeholder rather than crash.
  static func read() -> WeeklySpendWidgetSnapshot? {
    guard let defaults = UserDefaults(suiteName: WidgetContract.appGroup) else {
      return nil
    }
    guard let json = defaults.string(forKey: WidgetContract.snapshotKey),
          let data = json.data(using: .utf8) else {
      return nil
    }
    return try? JSONDecoder().decode(WeeklySpendWidgetSnapshot.self, from: data)
  }
}

// MARK: - Fixed brand palette (system light/dark; widget cannot read live theme)

private enum Palette {
  static func background(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? Color(hex: "#111827") : Color(hex: "#FFFFFF")
  }
  static func textPrimary(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? Color(hex: "#F3F4F6") : Color(hex: "#1F2937")
  }
  static func textSecondary(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? Color(hex: "#9CA3AF") : Color(hex: "#6B7280")
  }
  static let barGreen = Color(hex: "#10B981")
  static let barAmber = Color(hex: "#F59E0B")
  static let barRed = Color(hex: "#EF4444")

  /// Track behind the progress bar fill.
  static func barTrack(_ scheme: ColorScheme) -> Color {
    (scheme == .dark ? Color(hex: "#374151") : Color(hex: "#E5E7EB"))
  }

  /// Budget bar color: green <= 80%, amber <= 100%, red > 100% (identical to
  /// the Android side — see GoldFinchWidget.kt).
  static func bar(forPercent percent: Int) -> Color {
    if percent > 100 { return barRed }
    if percent > 80 { return barAmber }
    return barGreen
  }
}

// MARK: - Hex color parsing (tolerant of "#RRGGBB", "RRGGBB", "#RGB")

extension Color {
  /// Parse a hex string from the snapshot. Tolerates a leading '#', 3/6/8-digit
  /// forms; falls back to a neutral grey on anything unparseable so a bad
  /// category color never blanks a dot.
  init(hex: String) {
    let cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "#", with: "")
    var value: UInt64 = 0
    guard Scanner(string: cleaned).scanHexInt64(&value) else {
      self = Color(.sRGB, red: 0.61, green: 0.64, blue: 0.69, opacity: 1) // #9CA3AF
      return
    }
    let r, g, b, a: Double
    switch cleaned.count {
    case 3: // RGB (4 bits each)
      r = Double((value >> 8) & 0xF) / 15.0
      g = Double((value >> 4) & 0xF) / 15.0
      b = Double(value & 0xF) / 15.0
      a = 1.0
    case 6: // RRGGBB
      r = Double((value >> 16) & 0xFF) / 255.0
      g = Double((value >> 8) & 0xFF) / 255.0
      b = Double(value & 0xFF) / 255.0
      a = 1.0
    case 8: // RRGGBBAA
      r = Double((value >> 24) & 0xFF) / 255.0
      g = Double((value >> 16) & 0xFF) / 255.0
      b = Double((value >> 8) & 0xFF) / 255.0
      a = Double(value & 0xFF) / 255.0
    default:
      r = 0.61; g = 0.64; b = 0.69; a = 1.0 // #9CA3AF fallback
    }
    self = Color(.sRGB, red: r, green: g, blue: b, opacity: a)
  }
}

// MARK: - Timeline

struct WidgetEntry: TimelineEntry {
  let date: Date
  let snapshot: WeeklySpendWidgetSnapshot?
}

struct WidgetTimelineProvider: TimelineProvider {
  /// Placeholder shown in the gallery / while redacted. A nil snapshot renders
  /// the neutral "no data yet" state.
  func placeholder(in context: Context) -> WidgetEntry {
    WidgetEntry(date: Date(), snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
    completion(WidgetEntry(date: Date(), snapshot: WeeklySpendWidgetSnapshot.read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
    let entry = WidgetEntry(date: Date(), snapshot: WeeklySpendWidgetSnapshot.read())
    // The bridge calls WidgetCenter.shared.reloadAllTimelines() on every write,
    // so this period is only a safety net for the rare case the app never runs.
    let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

// MARK: - Formatting helpers

private enum Format {
  /// "Jun 9 - Jun 15" from the Mon..Sun ISO date strings. Falls back to the raw
  /// strings if either fails to parse (never hard-codes a week shape).
  static func weekRange(start: String, end: String) -> String {
    guard let s = isoDate(start), let e = isoDate(end) else {
      return "\(start) - \(end)"
    }
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US")
    // Match isoDate()'s UTC zone: the snapshot weekStart/weekEnd are UTC calendar
    // dates, so formatting in device-local time would shift them a day west of UTC.
    fmt.timeZone = TimeZone(identifier: "UTC")
    fmt.dateFormat = "MMM d"
    return "\(fmt.string(from: s)) - \(fmt.string(from: e))"
  }

  private static func isoDate(_ s: String) -> Date? {
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US_POSIX")
    fmt.timeZone = TimeZone(identifier: "UTC")
    fmt.dateFormat = "yyyy-MM-dd"
    return fmt.date(from: s)
  }

  /// Currency symbol-less display from the snapshot's lossless decimal string +
  /// the ISO currency code (e.g. "$12.34"). The decimal string is authoritative;
  /// we only attach a symbol, never re-do math.
  static func money(_ decimalString: String, currency: String) -> String {
    let symbol = currencySymbol(currency)
    return "\(symbol)\(decimalString)"
  }

  private static func currencySymbol(_ code: String) -> String {
    switch code.uppercased() {
    case "USD", "CAD", "AUD", "NZD", "MXN": return "$"
    case "EUR": return "\u{20AC}"
    case "GBP": return "\u{00A3}"
    case "JPY", "CNY": return "\u{00A5}"
    default: return code.uppercased() + " "
    }
  }
}

// MARK: - Subviews

/// "This week" header + Mon..Sun date range. Identical across every branch so
/// the period label is single-sourced.
private struct WidgetHeader: View {
  let snapshot: WeeklySpendWidgetSnapshot
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text("This week")
        .font(.caption)
        .fontWeight(.semibold)
        .foregroundColor(Palette.textSecondary(scheme))
      Text(Format.weekRange(start: snapshot.weekStart, end: snapshot.weekEnd))
        .font(.caption2)
        .foregroundColor(Palette.textSecondary(scheme))
    }
  }
}

/// Budget progress bar. Fill clamped to [0, 100]; the percent label shows the
/// TRUE value (may exceed 100). Color: green <= 80, amber <= 100, red > 100.
private struct BudgetBar: View {
  let percent: Int
  let showPercentLabel: Bool
  @Environment(\.colorScheme) private var scheme

  private var fillFraction: CGFloat {
    let clamped = min(max(percent, 0), 100)
    return CGFloat(clamped) / 100.0
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          RoundedRectangle(cornerRadius: 4)
            .fill(Palette.barTrack(scheme))
          RoundedRectangle(cornerRadius: 4)
            .fill(Palette.bar(forPercent: percent))
            .frame(width: max(2, geo.size.width * fillFraction))
        }
      }
      .frame(height: 6)
      if showPercentLabel {
        Text("\(percent)% of budget")
          .font(.caption2)
          .foregroundColor(Palette.textSecondary(scheme))
      }
    }
  }
}

/// One category row: colored dot + name (+ amount when showAmounts).
private struct CategoryRow: View {
  let category: WidgetTopCategory
  let showAmounts: Bool
  let currency: String
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(Color(hex: category.color))
        .frame(width: 8, height: 8)
      Text(category.name)
        .font(.caption2)
        .lineLimit(1)
        .foregroundColor(Palette.textPrimary(scheme))
      Spacer(minLength: 4)
      if showAmounts {
        Text(Format.money(category.spent, currency: currency))
          .font(.caption2)
          .fontWeight(.medium)
          .monospacedDigit()
          .foregroundColor(Palette.textSecondary(scheme))
      }
    }
  }
}

// MARK: - Primary content (amounts shown)

private struct WidgetContentView: View {
  let snapshot: WeeklySpendWidgetSnapshot
  let showCategories: Bool
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      WidgetHeader(snapshot: snapshot)

      Text(Format.money(snapshot.spent, currency: snapshot.currency))
        .font(.system(.title2, design: .rounded))
        .fontWeight(.bold)
        .monospacedDigit()
        .minimumScaleFactor(0.6)
        .lineLimit(1)
        .foregroundColor(Palette.textPrimary(scheme))

      if let percent = snapshot.percentOfBudget {
        BudgetBar(percent: percent, showPercentLabel: true)
      }

      if showCategories && !snapshot.topCategories.isEmpty {
        Divider().opacity(0.5)
        VStack(alignment: .leading, spacing: 3) {
          ForEach(snapshot.topCategories.prefix(3), id: \.self) { cat in
            CategoryRow(category: cat, showAmounts: true, currency: snapshot.currency)
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}

// MARK: - Amount-less content (showAmounts == false)

private struct WidgetContentViewNoAmounts: View {
  let snapshot: WeeklySpendWidgetSnapshot
  let showCategories: Bool
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      WidgetHeader(snapshot: snapshot)

      // No dollar figure. If a budget exists, the bar + percent still convey
      // progress; otherwise a neutral "Amounts hidden" indicator.
      if let percent = snapshot.percentOfBudget {
        BudgetBar(percent: percent, showPercentLabel: true)
      } else {
        Text("Amounts hidden")
          .font(.subheadline)
          .fontWeight(.semibold)
          .foregroundColor(Palette.textPrimary(scheme))
      }

      if showCategories && !snapshot.topCategories.isEmpty {
        Divider().opacity(0.5)
        VStack(alignment: .leading, spacing: 3) {
          ForEach(snapshot.topCategories.prefix(3), id: \.self) { cat in
            // Category names + dots only; no per-row amounts.
            CategoryRow(category: cat, showAmounts: false, currency: snapshot.currency)
          }
        }
      }
      Spacer(minLength: 0)
    }
  }
}

// MARK: - Neutral placeholder (no snapshot yet)

private struct WidgetPlaceholderView: View {
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("This week")
        .font(.caption)
        .fontWeight(.semibold)
        .foregroundColor(Palette.textSecondary(scheme))
      Spacer(minLength: 0)
      Text("Open GoldFinch to sync")
        .font(.caption2)
        .foregroundColor(Palette.textSecondary(scheme))
      Spacer(minLength: 0)
    }
  }
}

// MARK: - Entry view (branches on family, showAmounts, budget)

struct WidgetExtensionEntryView: View {
  var entry: WidgetEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  /// Medium = wide enough for the top-3 categories. Small omits them.
  private var showCategories: Bool { family == .systemMedium }

  var body: some View {
    Group {
      if let snapshot = entry.snapshot {
        if snapshot.showAmounts {
          WidgetContentView(snapshot: snapshot, showCategories: showCategories)
        } else {
          WidgetContentViewNoAmounts(snapshot: snapshot, showCategories: showCategories)
        }
      } else {
        WidgetPlaceholderView()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(14)
    .widgetBackground(Palette.background(scheme))
    // Tapping anywhere opens the app to its dashboard (golden root).
    .widgetURL(URL(string: WidgetContract.deepLink))
  }
}

/// `containerBackground` is required on iOS 17+; the modifier degrades to a
/// plain background on older OSes so the widget renders on iOS 14-16 too.
private extension View {
  @ViewBuilder
  func widgetBackground(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      self.containerBackground(color, for: .widget)
    } else {
      self.background(color)
    }
  }
}

// MARK: - Widget definitions

struct GoldFinchSmallWidget: Widget {
  let kind = "GoldFinchSmallWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: WidgetTimelineProvider()) { entry in
      WidgetExtensionEntryView(entry: entry)
    }
    .configurationDisplayName("This Week")
    .description("Your spending so far this week.")
    .supportedFamilies([.systemSmall])
  }
}

struct GoldFinchMediumWidget: Widget {
  let kind = "GoldFinchMediumWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: WidgetTimelineProvider()) { entry in
      WidgetExtensionEntryView(entry: entry)
    }
    .configurationDisplayName("This Week + Top Categories")
    .description("Weekly spending plus your top three categories.")
    .supportedFamilies([.systemMedium])
  }
}

// MARK: - Bundle entry point

@main
struct GoldFinchWidgetBundle: WidgetBundle {
  var body: some Widget {
    GoldFinchSmallWidget()
    GoldFinchMediumWidget()
  }
}
