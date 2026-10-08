import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import { config } from './config';

/**
 * Sends app errors to GlitchTip (ADR-0038) through the Sentry SDK, on the API's own address (/errors/…),
 * so the VPN, phone mode and the web build (/m) all work without extra hosts. Nothing about the user is
 * sent: no IP address, user, request data or breadcrumbs. Without a key it does nothing. Builds without
 * Sentry's native module (Expo Go, today's development build) report JavaScript errors only.
 */
export function startErrorReporting() {
  const { errorsPublicKey, errorsProjectId } = config;
  if (!errorsPublicKey || !errorsProjectId || Sentry.getClient()) return;
  const base = Platform.OS === 'web' ? window.location.origin : config.apiBaseUrl;
  const url = new URL(base);
  Sentry.init({
    dsn: `${url.protocol}//${errorsPublicKey}@${url.host}/errors/${errorsProjectId}`,
    release: Constants.expoConfig?.version,
    environment: __DEV__ ? 'development' : 'production',
    enableNative: Boolean(NativeModules.RNSentry),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
      }
      return event;
    },
  });
}

/** Reports an error caught by an error boundary. */
export function reportError(error: unknown) {
  if (Sentry.getClient()) Sentry.captureException(error);
}
