# 0029 — The iOS app uses Apple's native components (Liquid Glass, SF Symbols, SwiftUI, widget)

- Status: Accepted
- Date: 2026-10-04

## Context

The app ran with its own "Fjord Glass" look on every platform (ADR-0021): a floating tab bar, blurred
glass surfaces and Ionicons. With an Apple Developer account and development builds (EAS), the iOS app
no longer needs to fit Expo Go, and iOS 26 brings Liquid Glass. An app that looks and behaves like
Apple's own (navigation, sheets, menus, haptics, accessibility) is what iPhone users expect, and it is
what App Review and Apple's Human Interface Guidelines ask for.

## Decision

On iOS the app uses the system's components wherever one exists; Android and the web keep the Fjord
Glass components. Platform files (`*.ios.tsx`) hold the iOS versions, so the shared screens stay the same.

- **Navigation:** the system tab bar (expo-router native tabs: Home, Search, Sell, Messages, Account),
  drawn in Liquid Glass on iOS 26 with SF Symbols and a native unread badge. The middle Sell tab is a
  place (the category step of a new listing), not an action, as the guidelines ask. Native navigation
  bars: transparent with the scroll edge effect on list screens, large titles, and SF Symbol bar
  buttons (favourite, share) over the listing photo.
- **Surfaces and controls:** `GlassView` (expo-glass-effect) for glass surfaces, SF Symbols
  (expo-symbols) for icons, SwiftUI controls (@expo/ui) for the segmented pickers and the sort menu,
  a form sheet for the first message to a seller, swipe actions on lists, pull to refresh, haptics
  (expo-haptics), and the keyboard dismissed interactively as in Messages.
- **Accessibility:** rows and cards are single VoiceOver elements with short labels, swipe actions are
  also VoiceOver actions, icons are decorative, and compact text grows with Dynamic Type up to 1.5x.
- **Notifications:** message pushes carry the category `message`, so a reply can be written on the
  notification itself and is sent without opening the app.
- **Widget:** a WidgetKit extension (`targets/widget`, @bacons/apple-targets) shows saved searches and
  their new matches on the home and lock screen. The app writes its data to the App Group
  `group.com.raadiso.app`.
- **App icon:** light, dark and tinted variants.

## Alternatives considered

- **One look everywhere** (Fjord Glass only): less code, but the app would not feel like an iPhone app
  and would miss Liquid Glass, system menus and accessibility behaviour that users rely on.
- **Writing the iOS app in Swift:** the most native result, but a second app to build and keep in step
  with the web and Android. Expo's native modules give the system components from the shared code.
- **Long-press previews and context menus** (expo-router `Link.Preview`): tried, but they did not open
  on the test device, so they were removed again.

## Consequences

- New native modules need a new development build (EAS); JavaScript changes still arrive through Metro.
- The widget is a second bundle (`com.raadiso.app.widget`) with its own provisioning profile and the App
  Group capability. Its signing credentials are created once from a terminal signed in to Apple
  (docs/mobile.md).
- Android and the web are unchanged and keep their tests; the iOS-only parts are checked by compiling
  the iOS bundle in Metro and on the device.
