import type { ExpoConfig } from 'expo/config';

// Native builds talk to the gateway and Keycloak directly (OIDC + PKCE, ADR-0021). The web build is
// served by the gateway under /m and uses the website's session instead, so it needs no URLs.
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://raadi.localhost';
const authBaseUrl = process.env.AUTH_BASE_URL ?? 'http://auth.raadi.localhost';

// The Expo project this app is linked to (phone mode: Expo Go on an iPhone needs a signed-in, linked
// project). Set in .env; without them the app is a standalone, offline project called "raadi".
const easProjectId = process.env.EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: 'Raadiso',
  slug: process.env.EXPO_SLUG ?? 'raadi',
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  version: '0.1.0',
  scheme: 'raadi',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // The brand mark (the same shapes as the website's favicon): white "r", blue dot, ink ground.
  icon: './assets/icon.png',
  // Registered with Apple (permanent): the brand's domain, reversed.
  ios: {
    bundleIdentifier: 'com.raadiso.app',
    supportsTablet: true,
    // Only HTTPS/TLS from the OS: no export compliance documents needed for TestFlight.
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: 'com.raadiso.app',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0e1116' },
  },
  web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    // Development builds (EAS, eas.json): our own app with the dev menu, loading code from Metro.
    'expo-dev-client',
    'expo-secure-store',
    'expo-localization',
    'expo-web-browser',
    // Push notifications (ADR-0025); development builds get the entitlements from this plugin.
    ['expo-notifications', { color: '#3b5bff' }],
    // Photos for new listings: library and camera (development builds get the permission texts).
    [
      'expo-image-picker',
      {
        photosPermission: 'Raadiso uses your photos for the listings you create.',
        cameraPermission: 'Raadiso uses the camera to take photos for your listings.',
      },
    ],
  ],
  experiments: {
    // Only the web export lives under a sub-path; Expo Go serves the app from the dev server's root.
    ...(process.env.MOBILE_WEB_BASE_URL ? { baseUrl: process.env.MOBILE_WEB_BASE_URL } : {}),
  },
  extra: {
    publicBaseUrl,
    authBaseUrl,
    realm: process.env.KEYCLOAK_REALM ?? 'raadi',
    clientId: 'raadi-mobile',
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
