/**
 * 복도 카메라 → 체크아웃 판정에 쓰는 공용 타입. (SDK 나 prisma 에 의존하지 않아 어디서나 import 가능)
 */

export type LuggageKind = 'none' | 'small_bag' | 'suitcase_or_large_bag' | 'unclear';
export type Direction = 'toward_exit' | 'toward_rooms' | 'unclear';
export type LikelyRole = 'guest' | 'staff' | 'unclear';

export interface CameraVerdict {
  peoplePresent: boolean;
  personCount: number;
  luggage: LuggageKind;
  direction: Direction;
  likelyRole: LikelyRole;
  /** 0~1 */
  confidence: number;
  /** 한 줄 한국어 설명 (카드에 그대로 표시) */
  summary: string;
  model: string;
  judgedAt: string;
}

/** 판정 규칙 한 곳: 짐을 들고 나가는 게스트로 보이고, 확신이 충분할 때만 "퇴실로 보임". */
export const LEAVING_CONFIDENCE_MIN = 0.7;

export function isLeavingWithLuggage(v: CameraVerdict): boolean {
  return (
    v.peoplePresent &&
    v.luggage === 'suitcase_or_large_bag' &&
    v.direction !== 'toward_rooms' &&
    v.likelyRole !== 'staff' &&
    v.confidence >= LEAVING_CONFIDENCE_MIN
  );
}

/** 사진을 넣는 Supabase Storage 비공개 버킷 */
export const CAMERA_BUCKET = (process.env.SUPABASE_STORAGE_BUCKET_CAMERA || 'camera-snapshots').trim();

/** 체크아웃 판정을 돌리는 KST 시간대 (이 밖의 감지는 사진만 저장) */
export const CHECKOUT_WINDOW = { fromHour: 9, toHour: 13.5 } as const;

export function kstHourFraction(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23' }).formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

export function inCheckoutWindow(d: Date): boolean {
  const h = kstHourFraction(d);
  return h >= CHECKOUT_WINDOW.fromHour && h < CHECKOUT_WINDOW.toHour;
}

export interface IncomingCameraImage {
  /** 'imap' | 'resend' | 'webhook' */
  source: string;
  /** 중복 방지 키 (메일 Message-ID 등) */
  messageId: string | null;
  capturedAt: Date;
  /** 수신 주소 (+태그로 지점 판별: cam+byulha@gmail.com) */
  to: string[];
  from: string | null;
  subject: string | null;
  text: string | null;
  filename: string;
  contentType: string;
  buffer: ArrayBuffer;
}
