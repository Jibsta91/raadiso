'use client';

import { useEffect } from 'react';

/**
 * Sends browser errors to GlitchTip (ADR-0038) through the Sentry SDK. Reports go to /errors/… on the
 * page's own address (the CSP stays connect-src 'self'), so the same build works on every host. Nothing
 * about the visitor is sent: no IP address, no cookies or headers, no user, no breadcrumbs of what they
 * typed. Without a key (GLITCHTIP_PUBLIC_KEY) it does nothing.
 */
export function ErrorReporting({
  publicKey,
  projectId,
  release,
  environment,
}: {
  publicKey: string;
  projectId: string;
  release: string;
  environment: string;
}) {
  useEffect(() => {
    if (!publicKey || !projectId) return;
    let cancelled = false;
    void import('@sentry/browser').then((Sentry) => {
      if (cancelled || Sentry.isInitialized()) return;
      const { protocol, host } = window.location;
      Sentry.init({
        dsn: `${protocol}//${publicKey}@${host}/errors/${projectId}`,
        release,
        environment,
        // Collect nothing about the visitor (Sentry 11; beforeSend below is the second guard).
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
        },
        tracesSampleRate: 0,
        // Only errors: no performance data, session replays or feedback widget.
        integrations: (defaults) => defaults.filter((i) => i.name !== 'Breadcrumbs'),
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
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, projectId, release, environment]);
  return null;
}

/** Reports an error caught by an error boundary (it never reaches window.onerror). */
export function reportError(error: unknown) {
  void import('@sentry/browser').then((Sentry) => {
    if (Sentry.isInitialized()) Sentry.captureException(error);
  });
}
