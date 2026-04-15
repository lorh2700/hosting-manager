import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'aws-1-ap-northeast-1.pooler.supabase.com',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.hhftvzockfgigsfonivp',
  password: process.env.DB_PASSWORD || '',
  max: 10,                // max connections in pool (default 10, explicit for clarity)
  idleTimeoutMillis: 20000, // close idle connections after 20s
  connectionTimeoutMillis: 5000, // fail fast if can't connect in 5s
});
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
