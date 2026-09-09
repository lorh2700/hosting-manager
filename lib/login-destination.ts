/** Limit return URLs to authenticated app pages on this origin. */
export function loginDestination(raw: string | null, role: string): string {
  const fallback = role === 'cleaner' ? '/cleaner' : '/admin';
  if (!raw || /[\\\x00-\x20]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, 'https://app.invalid');
    if (!raw.startsWith('/') || url.origin !== 'https://app.invalid') return fallback;
    const allowed = role === 'cleaner' ? ['/cleaner'] : role === 'admin' ? ['/admin', '/cleaner'] : ['/admin'];
    if (!allowed.some(root => url.pathname === root || url.pathname.startsWith(root + '/'))) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}
