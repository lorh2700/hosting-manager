import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
  // Port 6543 = Supavisor transaction mode (serverless-friendly, effectively unlimited clients).
  // Port 5432 = session mode, capped at ~15 clients and unsuitable for serverless fan-out.
  port: Number(process.env.DB_PORT || 6543),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.hhftvzockfgigsfonivp',
  password: process.env.DB_PASSWORD || '',
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
