-- 복도 카메라 스냅샷 (Reolink 이메일 → 사진 저장 → AI 퇴실 판정) + 숙소별 카메라 설정
-- Supabase SQL Editor 에서 배포 전에 실행한다. 여러 번 실행해도 안전하다.

ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "camera_name"  TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "camera_notes" TEXT;

CREATE TABLE IF NOT EXISTS "camera_snapshots" (
    "id"           TEXT NOT NULL,
    "property_id"  TEXT NOT NULL,
    "captured_at"  TIMESTAMP(3) NOT NULL,
    "date"         TEXT NOT NULL,
    "source"       TEXT NOT NULL,
    "message_id"   TEXT,
    "storage_path" TEXT NOT NULL,
    "camera_name"  TEXT,
    "verdict"      JSONB,
    "leaving"      BOOLEAN NOT NULL DEFAULT false,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "camera_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "camera_snapshots_message_id_key" ON "camera_snapshots"("message_id");
CREATE INDEX IF NOT EXISTS "camera_snapshots_property_id_date_idx" ON "camera_snapshots"("property_id", "date");
DO $$ BEGIN
  ALTER TABLE "camera_snapshots" ADD CONSTRAINT "camera_snapshots_property_id_fkey"
    FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
