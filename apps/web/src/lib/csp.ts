/**
 * The Content-Security-Policy for the website's and the console's pages (review A5): scripts only with
 * this request's nonce, and what those scripts load ('strict-dynamic'), never inline script or
 * javascript: URLs. Next.js reads the nonce from the request's CSP header and puts it on its own script
 * tags; our inline scripts take it from nonceFrom(). Styles stay 'unsafe-inline' (React style attributes).
 */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(
  nonce: string,
  opts: { authBaseUrl: string; dev: boolean },
): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only for the development server (React Refresh); production never evals.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    `form-action 'self' ${opts.authBaseUrl}`,
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** The nonce Next.js and our inline scripts use, from the policy the proxy put on the request. */
export function nonceFrom(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}
