# Mobile app

The Expo app in `apps/mobile` covers browsing, search, listing details, live chat, My listings and the
account (language and appearance). [ADR-0021](adr/0021-mobile-app-and-fjord-glass.md) records the decisions.

## Running it

- **In a browser** (works today): `./raadi up` builds the app's web export and serves it at
  <http://raadi.localhost/m/>. The `mobile-web` image runs `expo export` with `MOBILE_WEB_BASE_URL=/m`, and
  a small Node server (`apps/mobile/server/serve.mjs`) serves the files. The page signs in through the identity
  BFF's session cookie, like the website. After changing app code:
  `docker compose build mobile-web && docker compose up -d mobile-web`. Traefik can answer 503 for about 10 s
  while the new container passes its health check.
- **On a phone**: `./raadi phone` (details below).

## Phone mode

The native app runs in Expo Go on a phone on the same Wi-Fi as the laptop
([ADR-0022](adr/0022-phone-mode.md)). The stack then answers as `https://dev.raadiso.com`
(`PHONE_DOMAIN`), with a Let's Encrypt certificate the phone already trusts.

1. **Once:** at <https://developer.godaddy.com/keys>, create a Personal Access Token with the scopes
   `domains.domain:read` and `domains.dns:update`. Then store it from your own terminal. The input is hidden,
   and the token never goes into the repository or a chat:

   ```bash
   ./raadi secret-set godaddy_pat
   ```

   For an **iPhone** you also need a free Expo account: since Expo Go 57, Expo Go on a physical iPhone
   opens only projects served by an Expo CLI signed in to the same account. Create an access token at
   expo.dev (Account settings → Access tokens), store it with `./raadi secret-set expo_token`, and sign in
   to Expo Go with that account. Without the token, Metro stays offline (Android and simulators still work).

2. **Each time:** `./raadi phone`. This:
   - points `dev.raadiso.com` and `*.dev.raadiso.com` at the laptop's current LAN address (private
     addresses only, and only when they changed);
   - gets or renews the wildcard certificate with a DNS-01 challenge (nothing is exposed to the internet);
   - starts the stack on the LAN address and Metro on port 8081.

   The first certificate takes a minute or two while the challenge record propagates.

3. On the phone, install **Expo Go**, open it and enter `exp://<laptop LAN address>:8081` (printed by
   `./raadi phone`). Sign in with a demo user.
4. Back to the normal setup: `./raadi up`. The certificate and Keycloak's URLs switch back to
   `raadi.localhost` on their own.

Notes:

- While phone mode runs, the stack (with its demo passwords) is reachable from your LAN. Use it on a
  network you trust. The admin console and the dev tools (Mailpit, OpenBao, Traefik, Prometheus,
  Keycloak's admin console) are not served in phone mode; `PHONE_TOOLS=1 ./raadi phone` serves them.
- Fedora's firewall blocks ports 80 and 443 from the network by default. Open them for this session with
  `sudo firewall-cmd --add-service=http --add-service=https`.
- Some routers block DNS answers that point at private addresses ("DNS rebinding protection"). If the
  phone cannot resolve `dev.raadiso.com`, allow the domain in the router's settings, or set the phone's
  DNS to a public resolver.
- Metro runs in a container, where file changes on the host don't always arrive. After editing app code,
  reload in Expo Go (shake → Reload) or run `./raadi restart expo`.

## Tunnel mode (from anywhere)

Tunnel mode is phone mode reachable from outside the home network, for example on mobile data or for
someone else ([ADR-0034](adr/0034-tunnel-mode-pangolin.md)). The stack keeps running on the laptop, and
a self-hosted [Pangolin](https://docs.pangolin.net) runs next to it. It gives two ways in:

| Way in                               | Who                                   | What                                                                                                               |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Public**, after a Pangolin sign-in | anyone you give a Pangolin account    | `https://dev.raadiso.com` (website, API, `/m/`), `https://auth.dev.raadiso.com`, `https://pay.dev.raadiso.com`     |
| **VPN**, in the Pangolin app         | devices signed in to the Pangolin app | every `https://*.dev.raadiso.com` host (admin console and dev tools too), Metro at `https://metro.dev.raadiso.com` |

The native app in Expo Go always goes over the VPN: an API cannot show a sign-in page.

1. **Once, on the router:** forward TCP 80 and 443 and UDP 51820 and 21820 (both UDP: 21820 is the VPN
   clients' WireGuard port) to the laptop's LAN address
   (`./raadi tunnel` prints it). Give the laptop a fixed address (a DHCP reservation) so the rule keeps
   working. This needs a public IPv4 address from your ISP: if the router's WAN address differs from the
   one at <https://ifconfig.me>, or starts with `100.64`–`100.127`, you are behind carrier-grade NAT and
   tunnel mode cannot work from home.
2. **Once, on the laptop:** the GoDaddy token from phone mode (`./raadi secret-set godaddy_pat`) and, on
   Fedora, the firewall:
   `sudo firewall-cmd --add-service=http --add-service=https`, then
   `sudo firewall-cmd --add-port=51820/udp --add-port=21820/udp` (firewalld doesn't take services and ports
   in one call; run both again with `--permanent` to keep them).
3. **Each time:** `./raadi tunnel`. This:
   - points `dev.raadiso.com`, `*.dev.raadiso.com` and `pangolin.raadiso.com` at the home's public
     address (only when it changed);
   - gets or renews the Let's Encrypt wildcards with DNS-01;
   - starts the stack as `https://dev.raadiso.com`, plus Pangolin, Gerbil, Pangolin's Traefik and the site
     connector, and Metro;
   - creates the Pangolin admin, the organisation and the site on the first run, and applies the
     resources in `deploy/pangolin/blueprint.json.tmpl` every time.
4. **Sign in:** open `https://pangolin.raadiso.com` as `admin@raadiso.com` (`PANGOLIN_ADMIN_EMAIL`) with
   the password from `./raadi secret pangolin_admin_password`. The same account opens the public
   resources.
5. **VPN on a phone or laptop:** install the Pangolin app (App Store, Google Play, or pangolin.net for
   desktops), add the server `https://pangolin.raadiso.com`, sign in and connect. Then open Expo Go and
   open the app:
   - **Development build** (Raadiso): "Enter URL manually" → `https://metro.dev.raadiso.com`.
   - **Expo Go:** `exps://metro.dev.raadiso.com`.

   Metro is served over HTTPS through the gateway because iOS (App Transport Security) lets a development
   build load plain `http://` only from IP addresses, as in phone mode. Any `https://*.dev.raadiso.com` page
   works over the VPN too.

6. **Back to normal:** `./raadi up` stops Pangolin and returns to `raadi.localhost`.

Giving someone access: in the dashboard, invite a user (Organisation → Users → Invite; without e-mail,
copy the invite link). Then add them to the public resources (Resources → the resource → Authentication),
or to the private resources for the VPN. A user added by hand stays until you remove them; the blueprint
manages only the admin.

Notes:

- The tunnel works only while the laptop is on the network that forwards the ports. When the home address
  changes, run `./raadi tunnel` again to update DNS.
- At home, `dev.raadiso.com` now points at the router. Opening it from the laptop or a phone on the same
  Wi-Fi needs the router to support NAT loopback (most do); the VPN works either way.
- Everyone using the tunnel reaches the gateway from the same address, so they share its per-client rate
  limits.
- A WAF (CrowdSec, [ADR-0035](adr/0035-crowdsec-waf-at-the-tunnel-edge.md)) answers 403 to requests that
  look like known exploits. If something legitimate is blocked, `docker exec raadi-crowdsec-1 cscli alerts
list` shows which rule matched.

## Development build (iPhone)

Instead of Expo Go, the iPhone can run our own app: **Raadiso (Development Build)**, bundle ID
`com.raadiso.app`, built in Expo's cloud from the `development` profile in `apps/mobile/eas.json`. It
loads code from Metro like Expo Go, but has its own icon, push setup and any native modules. A new
build is needed only when native modules or `app.config.ts` change.

- **Builds** start from GitHub (repository linked to the Expo project `@jibstas-team/jibsta`, base
  directory `apps/mobile`), so push to `main` first. They cannot sign in to Apple, so the signing
  credentials must already be on Expo.
- **Signing credentials** (distribution certificate and ad hoc provisioning profile) are created once,
  from your own terminal, signing in to Apple when asked. Run it to the end; nothing is saved if you stop
  it halfway:

  ```bash
  LAN_IP=127.0.0.1 docker compose -f compose.yaml -f compose.phone.yaml run --rm --no-deps \
    --entrypoint sh expo -c 'cd apps/mobile && npx -y eas-cli@24.10.0 credentials --platform ios'
  ```

  Choose `development` → Build Credentials → All: Set up all the required credentials.

- **Devices:** the profile lists every iPhone that may install the build. Register a device by opening
  expo.dev's "Register device" link in Safari on that phone, check its UDID with
  `eas device:list` (an iPhone XS or newer has a UDID like `00008140-…`; with the phone on USB,
  `cat /sys/bus/usb/devices/*/serial` shows it too), then run the credentials command again and build.
  "Integrity could not be verified" on install means the phone is not in the profile.
- **Running it:** turn on Developer Mode (Settings → Privacy & Security), start `./raadi phone`, open
  Raadiso and enter `http://<laptop LAN address>:8081` under "Enter URL manually".
- **Widget:** the "Saved searches" widget is a second bundle, `com.raadiso.app.widget`, sharing the
  App Group `group.com.raadiso.app` with the app ([ADR-0029](adr/0029-ios-native-look.md)). After a
  change to its entitlements or a new device, run the credentials command again: it sets up both
  targets. Its code is SwiftUI in `apps/mobile/targets/widget`.

## TestFlight ([ADR-0049](adr/0049-testflight-over-the-tunnel.md))

Until the Phase 5 server exists, the TestFlight build talks to the laptop's tunnel
(`https://dev.raadiso.com`) and works on phones with the **Pangolin VPN** connected, while
`./raadi tunnel` runs.

1. Once, in App Store Connect: nothing is needed beforehand; the first submission creates the app record
   "Raadiso" for `com.raadiso.app` (it asks for your Apple ID).
2. Build and send it to TestFlight from your own terminal (Apple sign-in with two-factor
   authentication; answer **Yes** to generating the App Store certificate and the provisioning profiles
   for both targets, the app and the widget):

   ```bash
   LAN_IP=127.0.0.1 docker compose -f compose.yaml -f compose.phone.yaml run --rm --no-deps \
     --entrypoint sh expo -c 'cd apps/mobile && npx -y eas-cli@24.10.0 build --platform ios \
     --profile testflight --submit'
   ```

   The build runs in Expo's cloud (EAS build minutes, about 15–25 minutes), then EAS uploads it to App
   Store Connect. Apple processes it for another 5–30 minutes.

3. In App Store Connect → TestFlight: add yourself (and anyone else in the team) as an **internal
   tester**. Internal testers get each build at once, without Apple's review. Install TestFlight on the
   iPhone and accept the invitation.
4. On the phone: connect the Pangolin VPN, then open Raadiso. Later builds: run step 2 again; the build
   number goes up by itself.

## Selling from the app

"Selg" on the home screen (or "Ny annonse" on the account screen) opens the same flow as the website:
category tiles, subcategory tiles, then photos, title and description, the category's details (from
`@raadi/catalog/attributes`, shared with the website's form), price and place. Photos come from the camera
or the photo library (`expo-image-picker`) and go to the media service like the website's uploads, where
they are virus-scanned and re-encoded without location data. In the web build (`/m`) there is no camera
button; the picker opens a file chooser.

## Search filters

With a category chosen, search shows a "Filtre" chip that opens the category's own filters: chips for the
facets (car make, fuel, gearbox, body type, property type, …) and "from – to" fields for year, mileage,
area, bedrooms, guests and price. The lists come from `@raadi/catalog/attributes`, like the website's.

## Push notifications

After sign-in the app asks for permission and registers its Expo push token with the notifications
service (ADR-0025). New messages, removed listings, reviews and promotions then arrive as pushes, and
tapping one opens the right screen. The switch on the account screen (and on the website's notifications
page) turns message pushes off.

- **Development:** pushes go to push-mock, never to a phone. See what was sent at
  `http://push.raadi.localhost/messages`.
- **On a real iPhone** (Expo Go): send through Expo's push service:
  `PUSH_URL=https://exp.host/--/api/v2/push/send ./raadi phone`. The project must be linked
  (`EAS_PROJECT_ID`, see above). Expo Go on Android cannot receive remote pushes; use a development build.
- Signing out removes the phone's token; uninstalling the app makes Expo report it, and the token is deleted.

## Layout

```text
apps/mobile/src/app/          Expo Router screens: (tabs)/ home, search, sell, messages, account;
                              listings/[id], listings/new, categories/[id], contact/[listingId],
                              messages/[id], my-listings, favourites, saved-searches, notifications,
                              users/[id] (trust profile), auth, +not-found
apps/mobile/src/components/   ui.tsx (Fjord Glass primitives), listing-card.tsx (tile, row, heart,
                              skeleton; ADR-0048), photo-viewer.tsx (full-screen photos), no-photo.tsx
apps/mobile/src/lib/          api (typed clients, useLoad, usePaged), auth (provider.tsx for web,
                              provider.native.tsx for devices), realtime (one shared WebSocket), storage,
                              push (push.native.tsx registers the device; push.tsx is the web no-op),
                              saved (one shared copy of the favourite ids), recent (recently viewed,
                              on the device only)
apps/mobile/src/theme.tsx     palettes, fonts and the System / Light / Dark preference
apps/mobile/src/i18n/         nb / en / so catalogue (wording follows apps/web/messages)
apps/mobile/server/serve.mjs  static server for the web export
```

## Checks

- `./raadi lint typecheck test` covers the app (package `mobile`).
- `./raadi smoke` checks that `/m/` serves the app shell with its own CSP, the JavaScript bundle and client
  routes.
- `./raadi e2e e2e specs/mobile.spec.ts` drives the web build at phone size: search, a listing, sign-in,
  My listings and logout.

## Things to know

- On the web, never hand a style **array** to `expo-image`, or to a `Pressable` inside `Link asChild`.
  react-native-web spreads it into the DOM as `{0: …}`. Pass one merged object instead.
- react-native-web leaves a `TextInput` statically positioned, so absolutely positioned siblings paint over
  it. The `Glass` backdrop layers therefore sit at `zIndex: -1` with `pointerEvents="none"`.
- Text fields show focus with their container's accent border, and `noFocusRing` removes the browser
  outline. Chromium ignores `outline-width` when `outline-style` is `auto`.
- `patches/expo-router@57.0.24.patch` fixes the `/m` base path for routes starting with "m". Check it
  whenever Expo is upgraded.
- Expo pins React Native and React. Install versions from Expo's bundled-module list, not the latest ones.
