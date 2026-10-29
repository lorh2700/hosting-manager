const PUBLIC_TRANSACTION_PATHS = ['/guest', '/i', '/guest-checkout', '/stay', '/invite', '/book/checkout'];

function within(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicTransactionPath(pathname: string) {
  return PUBLIC_TRANSACTION_PATHS.some(prefix => within(pathname, prefix));
}

export function legacyHttpMaintenanceResponse(
  pathname: string,
  env: Record<string, string | undefined> = process.env,
): Response | null {
  if (env.LEGACY_HTTP_MAINTENANCE !== 'true') return null;
  const api = within(pathname, '/api');
  if (!api && !isPublicTransactionPath(pathname)) return null;

  const message = '서비스 점검 중입니다. 잠시 후 다시 시도해 주세요. / Service maintenance is in progress. Please try again shortly.';
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '60' };
  return api
    ? Response.json({ error: message, code: 'SERVICE_UNAVAILABLE', retryable: true }, { status: 503, headers })
    : new Response(message, { status: 503, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
}
