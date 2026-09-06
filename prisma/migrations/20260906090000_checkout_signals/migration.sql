-- 체크아웃 신호 테이블 (패드 셀프 체크아웃, 호스트 확인, 이후 게스트 답장·카메라·문 센서)
-- Supabase SQL Editor 에서 배포 전에 실행한다. 여러 번 실행해도 안전하다.

CREATE TABLE IF NOT EXISTS "checkout_signals" (
    "id"          TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "date"        TEXT NOT NULL,
    "event_id"    TEXT,
    "kind"        TEXT NOT NULL,
    "at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note"        TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checkout_signals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "checkout_signals_property_id_date_idx" ON "checkout_signals"("property_id", "date");

DO $$ BEGIN
  ALTER TABLE "checkout_signals" ADD CONSTRAINT "checkout_signals_property_id_fkey"
    FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
