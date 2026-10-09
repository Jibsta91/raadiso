# 0048 — App 2.0: a FINN-style front page, cards with a heart, full-screen photos, grid or list

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0021](0021-mobile-app-and-fjord-glass.md) (Fjord Glass),
  [ADR-0029](0029-ios-native-look.md) (the iOS look) and
  [ADR-0047](0047-similar-and-recently-viewed.md) (recently viewed on the website).

## Context

The owner asked for the app to be measured against FINN's app and made better than it. FINN's app gets
the basics right: a front page that starts from the categories ("markets") and from what the user
cares about (saved searches with new hits, what they looked at), a heart on every card, prices that
line up under the photos, photos that open full screen, and results as a grid or a list. Our app had
a category chip row, a single page of 24 newest listings, prices in a chip over the photo and no way
to save a listing without opening it.

What FINN's app does not do, and we can, since search already knows it (ADR-0043, ADR-0044): show on
the card itself that a price is good or was just cut, by how much, and what it was.

## Decision

- **Front page:** the search field stays pinned on glass; below it, in order:
  - the categories as icon tiles (each country's own, ADR-0040);
  - **New in your saved searches**: saved searches with new matches, most first, one tap opens the
    results and resets the count (signed-in users only);
  - **Recently viewed** (with Clear);
  - the promoted carousel;
  - **Price dropped**: the ten most recent drops, with "See all" opening search with the filter and
    the price-drop sort;
  - the newest listings as a feed that loads the next page while scrolling (it used to stop at 24).
  Grey placeholder cards show while the first page loads, in place of a spinner.
- **Cards:** the photo carries one corner badge (sold, promoted, the drop in percent, or a good
  price, in that order), a photo count and a heart. Below the photo: the price, with the price before a
  drop struck through, then the title, then "place · age". The heart saves the listing without opening
  it, with haptics and a small pop. It is a sibling of the link, not inside it (a button inside an
  anchor is invalid HTML, and on the web its click would also follow the link).
- **One copy of the favourites:** a `FavouritesProvider` loads the user's favourite ids once and every
  heart reads it, so a grid costs one request, and a heart changed on one screen is right on all
  the others.
- **Recently viewed in the app:** the listing screen remembers the listing (title, price, first photo,
  place) on the device, the eight latest. Nothing is sent anywhere, and the user's own listings are not
  remembered. The native store is the keychain (SecureStore, already used for preferences), which
  warns above 2 KB a value. Entries are therefore stored with short keys and titles cut at 48
  characters, and the oldest are dropped until the list fits in 1,900 bytes (unit-tested).
- **Listing screen:** a tap on a photo opens it full screen on black (swipe between photos, pinch to
  zoom on iOS, thumbnails to jump, Close or Back to leave), and the gallery returns at the last photo
  seen. The bottom bar shows the price, with the old one struck through, beside the message button,
  as FINN does. Descriptions longer than about 400 characters are cut, with "Show more".
- **Search:** results as a grid or a list (a photo with the details beside it), remembered on the
  device, with the same skeleton cards while loading.

## Alternatives considered

- **A personalised "Recommended for you" feed, as FINN has:** it needs viewing history on the server
  or a model (Phase 4 is on hold). The newest feed, saved-search news, recently viewed and price drops
  cover most of it without either.
- **Favourite lists (several named lists, as FINN has):** needs a change to the saved service's API and
  data. It can come later on top of the shared provider.
- **Pinch to zoom on Android as well,** with gesture-handler and Reanimated: more code for a first
  version. Android gets full-screen swiping now.
- **expo-sqlite or AsyncStorage for recently viewed:** a new native module needs a new development
  build (ADR-0029), and the keychain holds eight short entries well enough.

## Consequences

- No API, event or schema changes: everything comes from search, saved and listings as they are.
- `ListingTile` takes `heart={false}` where a heart makes no sense (recently viewed); sold listings
  never show one.
- The front page makes three requests where it made one (newest, price drops, saved searches). All
  three are cached by the services' normal paths and run in parallel.
- New strings in English, Norwegian and Somali. The Somali ones join the list waiting for review by a
  native speaker.
