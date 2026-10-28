import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { postgresPoolOptions } from './postgres-config';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createClient() {
  const pool = new pg.Pool(postgresPoolOptions());
  const adapter = new PrismaPg(pool);
  pool.on('error', (error) => console.error('[db] idle connection error', error.message));
  return new PrismaClient({ adapter });
}

export const prisma =
  globalForPrisma.prisma ||
  createClient();

globalForPrisma.prisma = prisma;

export default prisma;
