import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createClient() {
  const pool = new pg.Pool({
    host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
    // Use the provider's transaction pooler for serverless deployments.
    port: Number(process.env.DB_PORT || 6543),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres.hhftvzockfgigsfonivp',
    password: process.env.DB_PASSWORD || '',
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
});
const adapter = new PrismaPg(pool);
pool.on('error', (error) => console.error('[db] idle connection error', error.message));
return new PrismaClient({ adapter });
}

export const prisma =
  globalForPrisma.prisma ||
  createClient();

globalForPrisma.prisma = prisma;

export default prisma;
