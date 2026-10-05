/** Runtime configuration (read per request, never baked into the image). */
export const env = {
  get identityBffUrl() {
    return process.env.IDENTITY_BFF_URL ?? 'http://identity-bff:4000';
  },
  get listingsUrl() {
    return process.env.LISTINGS_URL ?? 'http://listings:4000';
  },
  get searchUrl() {
    return process.env.SEARCH_URL ?? 'http://search:4000';
  },
  get messagingUrl() {
    return process.env.MESSAGING_URL ?? 'http://messaging:4000';
  },
  get notificationsUrl() {
    return process.env.NOTIFICATIONS_URL ?? 'http://notifications:4000';
  },
  get trustUrl() {
    return process.env.TRUST_URL ?? 'http://trust:4000';
  },
  get auditUrl() {
    return process.env.AUDIT_URL ?? 'http://audit:4000';
  },
  /** The admin console's session service and host (ADR-0028). */
  get adminBffUrl() {
    return process.env.ADMIN_BFF_URL ?? 'http://admin-bff:4000';
  },
  get adminBaseUrl() {
    return process.env.ADMIN_BASE_URL ?? 'http://admin.raadi.localhost';
  },
  get adminSessionCookie() {
    return process.env.ADMIN_SESSION_COOKIE_NAME ?? 'raadi_admin_sid';
  },
  /** Operations data for the console (ADR-0030): metrics and firing alerts, read-only. */
  get prometheusUrl() {
    return process.env.PROMETHEUS_URL ?? 'http://prometheus:9090';
  },
  get alertmanagerUrl() {
    return process.env.ALERTMANAGER_URL ?? 'http://alertmanager:9093';
  },
  get savedUrl() {
    return process.env.SAVED_URL ?? 'http://saved:4000';
  },
  get paymentsUrl() {
    return process.env.PAYMENTS_URL ?? 'http://payments:4000';
  },
  get publicBaseUrl() {
    return process.env.PUBLIC_BASE_URL ?? 'http://raadi.localhost';
  },
  get authBaseUrl() {
    return process.env.AUTH_BASE_URL ?? 'http://auth.raadi.localhost';
  },
  get realm() {
    return process.env.KEYCLOAK_REALM ?? 'raadi';
  },
  get sessionCookie() {
    return process.env.SESSION_COOKIE_NAME ?? 'raadi_sid';
  },
};
