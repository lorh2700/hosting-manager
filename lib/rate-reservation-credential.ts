import { createDecipheriv, hkdfSync } from 'node:crypto';
import { fail } from '@/lib/core/errors';
import type { ReservationBarrierSql } from './rate-reservation-barrier';

export interface ReservationCredentialContext {
  id: string; organization_id: string; provider: string;
  secret_ref: string; credential_generation: number; state: string;
}
export interface ReservationCredentialEnvironment {
  RATES_CONNECTION_SECRETS_JSON?: string;
  BACKEND_COMMAND_SECRET?: string;
}
export function reservationCredentialError(reason: string, message: string) {
  return fail(503, message, { code: 'rate_connection_mismatch', reason });
}
const unreadable = () => reservationCredentialError('stored_credential_unreadable', '저장된 Beds24 인증 정보를 읽지 못했습니다. 예약 서버의 연결 설정을 확인해 주세요.');

function decrypt(connection: ReservationCredentialContext, ciphertext: string, secret: string) {
  if (Buffer.byteLength(secret) < 32) throw reservationCredentialError('credential_key_missing', '예약 서버의 서비스 계정 암호화 키 설정이 필요합니다.');
  try {
    if (!ciphertext.startsWith('v1.') || ciphertext.length > 12000) throw unreadable();
    const bytes = Buffer.from(ciphertext.slice(3), 'base64url');
    if (bytes.length < 29) throw unreadable();
    // Matches the API's rate-connection-credential-v1 storage format and account binding.
    const key = Buffer.from(hkdfSync('sha256', secret, 'void-anchae', 'rate-connection-credential-v1', 32));
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(JSON.stringify([connection.id, connection.organization_id, connection.provider, connection.credential_generation])));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const value = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    if (!/^[\x21-\x7e]{1,4096}$/.test(value)) throw unreadable();
    return value;
  } catch { throw unreadable(); }
}

export async function reservationRateCredential(db: ReservationBarrierSql, connection: ReservationCredentialContext, environment: ReservationCredentialEnvironment): Promise<{ generation: number; refreshToken: string }> {
  if (!['setup', 'ready'].includes(connection.state)) throw reservationCredentialError('connection_inactive', '이 숙소의 Beds24 서비스 계정이 사용 중지되어 있습니다.');
  const [schema] = await db.$queryRawUnsafe<Array<{ present: boolean }>>("SELECT to_regclass('public.rate_connection_credentials') IS NOT NULL AS present");
  if (schema?.present) {
    const [stored] = await db.$queryRawUnsafe<Array<{ generation: number; ciphertext: string }>>('SELECT generation,ciphertext FROM rate_connection_credentials WHERE connection_id=$1', connection.id);
    if (stored) {
      if (stored.generation !== connection.credential_generation) throw reservationCredentialError('credential_generation_mismatch', 'Beds24 인증 정보가 변경되었습니다. 사업자 서비스 계정을 확인해 주세요.');
      return { generation: stored.generation, refreshToken: decrypt(connection, stored.ciphertext, environment.BACKEND_COMMAND_SECRET || '') };
    }
  }
  if (connection.secret_ref.startsWith('DB_RATE_')) throw reservationCredentialError('stored_credential_missing', '이 숙소의 Beds24 인증 정보가 없습니다. 사업자 설정에서 서비스 계정을 확인해 주세요.');
  let value: unknown;
  try { value = JSON.parse(environment.RATES_CONNECTION_SECRETS_JSON || '{}')[connection.secret_ref]; } catch { /* Invalid legacy configuration remains blocked. */ }
  if (!value || typeof value !== 'object' || !('generation' in value) || !('refreshToken' in value) ||
    value.generation !== connection.credential_generation || typeof value.refreshToken !== 'string' || !value.refreshToken) {
    throw reservationCredentialError('environment_credential_missing', '예약 서버의 Beds24 연결 인증 설정을 확인해 주세요.');
  }
  return { generation: connection.credential_generation, refreshToken: value.refreshToken };
}
