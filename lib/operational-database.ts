import { fail } from '@/lib/core/errors';

/** Missing access columns must fail closed with a recoverable operator-facing notice. */
export async function operationalDatabase<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['P2021', 'P2022'].includes(String(error.code))) {
      throw fail(503, '사업자·권한 설정을 사용하려면 데이터베이스 업데이트가 필요합니다.', { migrationRequired: true });
    }
    throw error;
  }
}
