export interface BackendConfig {
  host: string;
  port: number;
  bridgeSecret: string;
  jwtSecret: string;
  webOrigin: string;
}

export function backendConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const bridgeSecret = env.BACKEND_BRIDGE_SECRET || '';
  if (bridgeSecret.length < 32) throw new Error('BACKEND_BRIDGE_SECRET must contain at least 32 characters.');
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required for existing staff sessions.');
  const origin = new URL(env.BACKEND_WEB_ORIGIN || 'http://localhost:3117');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid BACKEND_WEB_ORIGIN.');
  const port = Number(env.BACKEND_PORT || 4100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid BACKEND_PORT.');
  if (env.NODE_ENV === 'production' && origin.protocol !== 'https:') throw new Error('Production BACKEND_WEB_ORIGIN must use HTTPS.');
  return { host: env.BACKEND_HOST || '127.0.0.1', port, bridgeSecret, jwtSecret: env.JWT_SECRET, webOrigin: origin.origin };
}
