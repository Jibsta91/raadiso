/**
 * A same-site path to send the browser to, or `fallback`. The same rules as identity-bff's
 * `safeReturnTo`: no "//evil.example" or "/\evil.example", and no control characters, because browsers
 * drop tabs and new lines from URLs, so "/\t/evil.example" would become "//evil.example".
 */
export function safePath(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex -- deliberately rejects control characters
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'http://raadi.invalid');
    return url.host === 'raadi.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
