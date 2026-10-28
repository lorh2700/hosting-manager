import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { postgresPoolOptions } from '../../lib/postgres-config';

export function backendPoolOptions(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  if (env.BACKEND_DB_TRANSPORT === 'cloudsql-unix') {
    return { ...postgresPoolOptions(env), idleTimeoutMillis: 30_000 };
  }
  if (env.BACKEND_DB_TRANSPORT && env.BACKEND_DB_TRANSPORT !== 'tcp') {
    throw new Error('BACKEND_DB_TRANSPORT must be tcp or cloudsql-unix.');
  }
  if (env.CLOUD_SQL_CONNECTION_NAME || env.DB_HOST?.startsWith('/')) {
    throw new Error('Cloud SQL sockets require the explicit cloudsql-unix database transport.');
  }
  if (!env.DATABASE_URL && !(env.DB_HOST && env.DB_USER && env.DB_PASSWORD)) throw new Error('Explicit backend database credentials are required.');
  const max = Number(env.BACKEND_DB_POOL_SIZE || 3);
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error('BACKEND_DB_POOL_SIZE must be between 1 and 20.');
  if (env.NODE_ENV === 'production' && env.BACKEND_DB_SSL === 'disable') throw new Error('Production backend database TLS cannot be disabled.');
  if (env.NODE_ENV === 'production' && env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    const mode = url.searchParams.get('sslmode');
    const ssl = url.searchParams.get('ssl');
    if (url.searchParams.getAll('sslmode').length > 1 || url.searchParams.getAll('ssl').length > 1 ||
        (mode !== null && mode !== 'verify-full') || (ssl !== null && !['true', '1'].includes(ssl))) {
      throw new Error('Production DATABASE_URL must use verified TLS with unambiguous SSL options.');
    }
  }
  return {
    ...(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : { host: env.DB_HOST, port: Number(env.DB_PORT || 6543), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME || 'postgres' }),
    ...(env.BACKEND_DB_SSL === 'require' || env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: true } } : env.BACKEND_DB_SSL === 'disable' ? { ssl: false } : {}),
    max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000,
  };
}

export function createBackendDatabase(env: NodeJS.ProcessEnv = process.env) {
  const pool = new pg.Pool(backendPoolOptions(env));
  pool.on('error', () => console.error(JSON.stringify({ component: 'backend-db', event: 'idle-connection-error' })));
  return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
}
