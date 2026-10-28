import type { PoolConfig } from 'pg';

export function postgresPoolOptions(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const limits = { max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5000 };
  const transport = env.BACKEND_DB_TRANSPORT || 'tcp';
  if (!['tcp', 'cloudsql-unix'].includes(transport)) {
    throw new Error('BACKEND_DB_TRANSPORT must be tcp or cloudsql-unix.');
  }
  if (transport === 'cloudsql-unix') {
    const instance = env.CLOUD_SQL_CONNECTION_NAME || '';
    if (instance !== instance.trim() || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z]+(?:-[a-z]+)+[1-9][0-9]?:[a-z](?:[a-z0-9-]{0,96}[a-z0-9])?$/.test(instance)) {
      throw new Error('CLOUD_SQL_CONNECTION_NAME must be a project:region:instance connection name.');
    }
    const host = `/cloudsql/${instance}`;
    if (env.DATABASE_URL || (env.DB_HOST && env.DB_HOST !== host) || (env.DB_PORT && env.DB_PORT !== '5432')) {
      throw new Error('Cloud SQL socket transport cannot be combined with a database URL or a different host or port.');
    }
    if (env.BACKEND_DB_SSL || env.BACKEND_DB_SSL_CA?.trim()) {
      throw new Error('Remove TCP TLS settings when using the Cloud SQL mounted socket.');
    }
    if (!env.DB_USER?.trim() || !env.DB_PASSWORD || !env.DB_NAME?.trim()) {
      throw new Error('Cloud SQL socket transport requires explicit DB_USER, DB_PASSWORD and DB_NAME.');
    }
    const max = Number(env.BACKEND_DB_POOL_SIZE || 3);
    if (!Number.isInteger(max) || max < 1 || max > 20) {
      throw new Error('BACKEND_DB_POOL_SIZE must be between 1 and 20.');
    }
    return { ...limits, max, host, port: 5432, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, ssl: false };
  }
  if (env.CLOUD_SQL_CONNECTION_NAME || env.DB_HOST?.startsWith('/')) {
    throw new Error('Cloud SQL sockets require the explicit cloudsql-unix database transport.');
  }
  return {
    host: env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
    port: Number(env.DB_PORT || 6543),
    database: env.DB_NAME || 'postgres',
    user: env.DB_USER || 'postgres.hhftvzockfgigsfonivp',
    password: env.DB_PASSWORD || '',
    ...limits,
  };
}
