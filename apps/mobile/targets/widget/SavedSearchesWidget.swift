import SwiftUI
import WidgetKit

/// The App Group shared with the app (app.config.ts, src/lib/widget-payload.ts).
private let appGroup = "group.com.raadiso.app"

struct SavedSearchItem: Codable, Identifiable, Hashable {
  let id: String
  let name: String
  let count: Int
}

/// What the app writes under the key "widget" (src/lib/widget-payload.ts). Texts arrive translated.
struct WidgetPayload: Codable {
  let title: String
  let empty: String
  let signedOut: Bool
  let signedOutText: String
  let total: Int
  let items: [SavedSearchItem]

  static let signedOutDefault = WidgetPayload(
    title: "Saved searches", empty: "No saved searches yet.", signedOut: true,
    signedOutText: "Open Raadiso to sign in.", total: 0, items: [])

  static let sample = WidgetPayload(
    title: "Saved searches", empty: "", signedOut: false, signedOutText: "", total: 5,
    items: [
      SavedSearchItem(id: "1", name: "Volvo XC60", count: 3),
      SavedSearchItem(id: "2", name: "Sofa", count: 2),
      SavedSearchItem(id: "3", name: "Bike", count: 0),
    ])
}

struct SavedSearchesEntry: TimelineEntry {
  let date: Date
  let payload: WidgetPayload
}

private func storedPayload() -> WidgetPayload {
  guard
    let json = UserDefaults(suiteName: appGroup)?.string(forKey: "widget"),
    let data = json.data(using: .utf8),
    let payload = try? JSONDecoder().decode(WidgetPayload.self, from: data)
  else { return .signedOutDefault }
  return payload
}

struct SavedSearchesProvider: TimelineProvider {
  func placeholder(in context: Context) -> SavedSearchesEntry {
    SavedSearchesEntry(date: Date(), payload: .sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (SavedSearchesEntry) -> Void) {
    completion(SavedSearchesEntry(date: Date(), payload: context.isPreview ? .sample : storedPayload()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SavedSearchesEntry>) -> Void) {
    // The app reloads the widget whenever it fetches new matches; an hourly refresh is the fallback.
    let entry = SavedSearchesEntry(date: Date(), payload: storedPayload())
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
  }
}

struct SavedSearchesView: View {
  @Environment(\.widgetFamily) private var family
  let entry: SavedSearchesEntry

  private var payload: WidgetPayload { entry.payload }
  private var message: String { payload.signedOut ? payload.signedOutText : payload.empty }

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Image(systemName: "magnifyingglass").font(.caption2)
          Text("\(payload.total)").font(.headline).widgetAccentable()
        }
      }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Label(payload.title, systemImage: "magnifyingglass")
          .font(.headline)
          .widgetAccentable()
        if let first = payload.items.first {
          Text(first.count > 0 ? "\(first.name) · +\(first.count)" : first.name)
            .font(.caption)
            .lineLimit(1)
        } else {
          Text(message).font(.caption).lineLimit(2)
        }
      }
    default:
      home
    }
  }

  private var home: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Image(systemName: "magnifyingglass").foregroundStyle(Color.accentColor).widgetAccentable()
        Text(payload.title).font(.headline).lineLimit(1)
        Spacer(minLength: 0)
        if payload.total > 0 {
          Text("\(payload.total)")
            .font(.caption.bold())
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .foregroundStyle(.white)
            .background(Capsule().fill(Color.accentColor))
            .widgetAccentable()
        }
      }
      if payload.signedOut || payload.items.isEmpty {
        Spacer(minLength: 0)
        Text(message).font(.subheadline).foregroundStyle(.secondary)
        Spacer(minLength: 0)
      } else {
        ForEach(Array(payload.items.prefix(family == .systemSmall ? 3 : 4))) { item in
          Link(destination: URL(string: "raadi://saved-searches/\(item.id)")!) {
            HStack(spacing: 4) {
              Text(item.name).font(.subheadline).lineLimit(1)
              Spacer(minLength: 4)
              if item.count > 0 {
                Text("+\(item.count)")
                  .font(.caption.bold())
                  .foregroundStyle(Color.accentColor)
                  .widgetAccentable()
              }
            }
          }
        }
        Spacer(minLength: 0)
      }
    }
  }
}

struct SavedSearchesWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SavedSearches", provider: SavedSearchesProvider()) { entry in
      SavedSearchesView(entry: entry)
        .containerBackground(.background, for: .widget)
        .widgetURL(URL(string: "raadi://saved-searches"))
    }
    .configurationDisplayName("Raadiso")
    .description("New matches in your saved searches.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
  }
}
