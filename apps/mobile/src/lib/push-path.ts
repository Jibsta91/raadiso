/**
 * The in-app path a push asks to open, or null. Only plain app paths are followed ("/messages/…"):
 * never URLs, protocol-relative paths or anything odd, so a forged push cannot send the user out
 * of the app.
 */
export function safeAppPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(value) || value.startsWith('//')) return null;
  return value;
}

/** True when a push points at the screen on show (the open conversation), so no banner is needed. */
export function isCurrentScreen(url: unknown, currentPath: string): boolean {
  const path = safeAppPath(url);
  return !!path && !!currentPath && path.replace(/\/$/, '') === currentPath.replace(/\/$/, '');
}

/** The conversation a push about a new message points at ("/messages/<id>"), or null. */
export function conversationOf(url: unknown): string | null {
  const path = safeAppPath(url);
  const match = path ? /^\/messages\/([A-Za-z0-9-]+)\/?$/.exec(path) : null;
  return match?.[1] ?? null;
}

/**
 * The app screen for an in-app notification's link, which is a website path without locale
 * ("/my/listings", "/users/<id>", "/listings/<id>", "/my/saved-searches?open=<id>"). Null for
 * anything the app has no screen for, so the notice is only marked read.
 */
export function notificationPath(link: string): string | null {
  const [path = '', query = ''] = link.split('?', 2);
  if (path === '/my/listings') return '/my-listings';
  if (path === '/my/favourites') return '/favourites';
  if (path === '/my/saved-searches') {
    const open = new URLSearchParams(query).get('open');
    return open && /^[A-Za-z0-9-]+$/.test(open) ? `/saved-searches/${open}` : '/saved-searches';
  }
  if (/^\/(listings|users)\/[A-Za-z0-9-]+$/.test(path)) return safeAppPath(path);
  return null;
}
