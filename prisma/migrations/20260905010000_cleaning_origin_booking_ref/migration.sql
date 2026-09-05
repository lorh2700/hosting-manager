-- ============================================================
-- 청소 생성 출처(origin) + 예약관리 Beds24 참조(channel_booking_ref)
--
-- 1. cleanings.origin
--    예약 체크아웃에서 자동 생성된 청소('auto')는 예약이 취소되거나 날짜가 바뀌면
--    배정 여부와 관계없이 동기화가 정리한다 (청소매니저에게 취소 문자 발송).
--    관리자/웰컴패드가 만든 청소('manual')와 파트너 API 청소('external')는
--    동기화가 건드리지 않는다.
--    기존 행 백필: external_source 가 있으면 'external', 나머지는 'auto'.
--      → 예약이 이미 취소된 채 남아 있던 배정 청소가 다음 동기화 때 정리된다.
--      → 관리자가 예약 없이 미리 잡아둔 "미래·배정·미완료" 청소가 있었다면
--        함께 정리될 수 있으니 적용 후 청소 캘린더를 한 번 확인할 것.
--
-- 2. bookings.channel_booking_ref
--    예약관리 페이지에서 Beds24 로 만든 예약의 Beds24 booking id. 이 값이 없어
--    취소가 Beds24 에 반영되지 않던 문제를 고친다.
--
-- 실행: Supabase SQL Editor → New query → 전체 붙여넣기 → Run
--       (코드 배포 전에 먼저 실행할 것 — Prisma 클라이언트가 새 컬럼을 조회한다)
-- ============================================================

ALTER TABLE "cleanings" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'auto';

UPDATE "cleanings"
   SET "origin" = 'external'
 WHERE "external_source" IS NOT NULL
   AND "origin" = 'auto';

CREATE INDEX IF NOT EXISTS "cleanings_property_id_origin_date_idx"
    ON "cleanings" ("property_id", "origin", "date");

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "channel_booking_ref" TEXT;

CREATE INDEX IF NOT EXISTS "bookings_channel_booking_ref_idx"
    ON "bookings" ("channel_booking_ref");
