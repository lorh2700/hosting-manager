-- 유저 관리 개선: 역할 3종(admin/manager/cleaner) + 청소담당자 지점 배정 + 알림 수신 플래그
-- Supabase SQL Editor 에서 배포 전에 실행한다. 여러 번 실행해도 안전하다.

-- 1) 청소담당자 지점 배정
CREATE TABLE IF NOT EXISTS "cleaner_properties" (
    "cleaner_id"  TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    CONSTRAINT "cleaner_properties_pkey" PRIMARY KEY ("cleaner_id", "property_id")
);
DO $$ BEGIN
  ALTER TABLE "cleaner_properties" ADD CONSTRAINT "cleaner_properties_cleaner_id_fkey"
    FOREIGN KEY ("cleaner_id") REFERENCES "cleaners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cleaner_properties" ADD CONSTRAINT "cleaner_properties_property_id_fkey"
    FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) 신규 오픈 알림 수신 플래그
ALTER TABLE "cleaners" ADD COLUMN IF NOT EXISTS "notify_new_open" BOOLEAN NOT NULL DEFAULT true;

-- 3) 기존 청소 계정의 숙소 범위(user_properties) → 담당자 배정으로 이관
INSERT INTO "cleaner_properties" ("cleaner_id", "property_id")
SELECT c."id", up."property_id"
FROM "user_properties" up
JOIN "cleaners" c ON c."user_id" = up."user_id"
ON CONFLICT DO NOTHING;
DELETE FROM "user_properties"
WHERE "user_id" IN (SELECT "user_id" FROM "cleaners" WHERE "user_id" IS NOT NULL);

-- 4) 역할 값 정규화 (코드는 옛 값도 읽을 수 있지만 데이터를 맞춰 둔다)
UPDATE "users" SET "role" = 'admin'   WHERE "role" = 'super_admin';
UPDATE "users" SET "role" = 'manager' WHERE "role" IN ('host', 'viewer');
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'manager';
