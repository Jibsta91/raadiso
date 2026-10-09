# 0049 — TestFlight before production: the app built for the tunnel, used over the Pangolin VPN

- Status: Accepted
- Date: 2026-10-09
- Builds on [ADR-0029](0029-ios-native-look.md) (development builds),
  [ADR-0034](0034-tunnel-mode-pangolin.md) (tunnel mode) and [ADR-0048](0048-app-2-home-cards-photos.md).

## Context

The owner wants the app on TestFlight now, before the Phase 5 server exists. A TestFlight build is a
standalone app: no Metro, so the server's addresses are built in. The only server today is the laptop
in tunnel mode (`dev.raadiso.com`). Pangolin puts a sign-in page in front of its public resources,
which a native app's API calls cannot pass, and the stack behind it is the development stack with
demo users and a published password.

## Decision

- **A `testflight` profile in `apps/mobile/eas.json`:** store distribution, the build number raised by
  EAS (`autoIncrement`, the version source is remote), and the tunnel's addresses
  (`PUBLIC_BASE_URL=https://dev.raadiso.com`, `AUTH_BASE_URL=https://auth.dev.raadiso.com`) and
  GlitchTip's public key built in. `APNS_MODE=production` gives the app Apple's production push
  environment, which store provisioning profiles require.
- **Testers use the Pangolin VPN.** With the VPN connected, every `*.dev.raadiso.com` host is reached
  directly, without Pangolin's sign-in. Nothing more is opened to the internet. The app works only while
  the laptop runs `./raadi tunnel`.
- **Builds and submissions run from the owner's terminal.** `eas build --profile testflight --submit`
  creates the App Store signing credentials and the App Store Connect app record the first time. Both
  need an Apple sign-in with two-factor authentication, which an agent or a GitHub-started build
  cannot do.

## Alternatives considered

- **Removing Pangolin's sign-in in front of the app and Keycloak hosts:** testers would need no VPN,
  but the development stack and its demo logins would be open to anyone.
- **Waiting for the Phase 5 server:** always on and open to any tester, but it delays TestFlight until
  production exists. The `testflight` profile will be changed to `raadiso.com` then.

## Consequences

- TestFlight testers are limited to people with a Pangolin account; the app shows network errors
  without the VPN or when the laptop is off.
- Each build uses EAS build minutes. External testers need Apple's Beta App Review once; internal testers
  (members of the App Store Connect team) do not.
- Pushes in this build need the real push service (`PUSH_URL`, docs/mobile.md); the development
  stack's push mock delivers nothing to a phone.
