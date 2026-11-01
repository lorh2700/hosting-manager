const routes: Record<string, string> = {
  '/admin': '/today', '/admin/ops': '/today', '/admin/calendar': '/calendar',
  '/admin/bookings': '/reservations', '/admin/cleaning-report': '/settlement',
  '/admin/settings/profile': '/account', '/admin/users': '/staff', '/admin/cleaners': '/staff',
  '/admin/staff': '/staff', '/admin/inventory': '/inventory', '/admin/laundry': '/laundry',
  '/admin/supplies': '/supplies', '/admin/guests': '/guests', '/admin/jongno-events': '/jongno-events',
  '/admin/properties': '/properties', '/admin/settings': '/settings', '/admin/activity': '/activity',
};

const queryKeys = new Set(['date', 'month', 'view', 'propertyId', 'scope', 'properties', 'channel',
  'reservationId', 'organizationId', 'section', 'tab', 'period', 'weekMonth', 'onlyWork']);
const propertySections: Record<string, string> = {
  settings: 'info', channels: 'channels', camera: 'room', 'checkout-qr': 'room',
};
const cleanerViews: Record<string, string> = { '/cleaner/schedule': 'available', '/cleaner/calendar': 'mine' };

function cleanerSource(source: Pick<URL, 'pathname' | 'searchParams'>) {
  if (cleanerViews[source.pathname.replace(/\/$/, '')]) return source;
  const next = source.searchParams.get('next');
  if (source.pathname !== '/login' || source.searchParams.getAll('next').length !== 1 || !next?.startsWith('/') || next.startsWith('//')) return null;
  if (!URL.canParse(next, 'https://legacy.invalid')) return null;
  const url = new URL(next, 'https://legacy.invalid');
  return url.origin === 'https://legacy.invalid' && cleanerViews[url.pathname.replace(/\/$/, '')] ? url : null;
}

export function adminAppDestination(
  method: string,
  source: Pick<URL, 'pathname' | 'searchParams'>,
  configuredOrigin: string | undefined,
): URL | null {
  if (!configuredOrigin || (method !== 'GET' && method !== 'HEAD')) return null;
  const cleaner = cleanerSource(source);
  const pathname = source.pathname.replace(/\/$/, '');
  const property = /^\/admin\/properties\/([A-Za-z0-9_-]{1,128})(?:\/(settings|channels|camera|checkout-qr))?$/.exec(pathname);
  const destination = cleaner ? '/cleanings' : routes[pathname] || (property ? property[2] ? `/properties/${property[1]}` : '/calendar' : null);
  if (!destination) return null;

  const origin = URL.canParse(configuredOrigin) ? new URL(configuredOrigin) : null;
  if (!origin || origin.protocol !== 'https:' || origin.username || origin.password ||
    origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('ADMIN_APP_ORIGIN must be an HTTPS origin without credentials, path, query or fragment.');
  }
  const target = new URL(destination, origin.origin);
  if (cleaner) {
    for (const key of ['date', 'propertyId', 'properties']) {
      for (const value of cleaner.searchParams.getAll(key)) target.searchParams.append(key, value);
    }
    const month = cleaner.searchParams.get('month');
    if (!target.searchParams.has('date') && month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) target.searchParams.set('date', `${month}-01`);
    target.searchParams.set('view', cleanerViews[cleaner.pathname.replace(/\/$/, '')]);
    target.searchParams.set('period', cleaner.searchParams.get('period') === 'week' || cleaner.searchParams.get('view') === 'week' ? 'week' : 'month');
    return target;
  }
  for (const [key, value] of source.searchParams) {
    if (queryKeys.has(key)) target.searchParams.append(key, value);
  }
  if (property) {
    if (property[2]) target.searchParams.set('section', propertySections[property[2]]);
    else {
      target.searchParams.set('propertyId', property[1]);
      target.searchParams.set('scope', 'property');
      target.searchParams.delete('properties');
    }
  }
  return target;
}
