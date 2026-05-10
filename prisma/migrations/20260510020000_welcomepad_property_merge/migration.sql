-- ============================================================
-- Welcome-pad / hosting-manager — Phase 1 통합
--
-- hotel-welcome-pad 프로젝트의 welcomepad_property 테이블에 들어있던
-- 지점 메타(호텔명·로고·테마·wifi·정비모드 플래그)를 hosting-manager 영역
-- 으로 옮긴다. 두 프로젝트가 같은 Supabase DB라 단일 ALTER + INSERT...
-- SELECT 한 번이면 끝나지만, 안전을 위해 단계별로 나눠서 실행.
--
-- 마이그레이션 후:
--   • properties.welcomepad_key  ← 'anon' / 'unwadang' / 'hwayeonjae' / 'dowonjae'
--   • welcomepad_configs (1:1 with properties) ← 설정 데이터
--
-- welcomepad_property 테이블 자체는 다음 4개 테이블이 FK로 참조 중이라
-- Phase 1에서는 유지한다(데이터는 그대로 두되 패드 클라이언트가 더 이상
-- 설정 컬럼을 읽지 않게 됨):
--   - welcomepad_current_guest
--   - welcomepad_weather
--   - welcomepad_guest_history
--   - welcomepad_message_threads
-- 이 테이블들이 정리되는 Phase 2/3에서 welcomepad_property도 drop 가능.
--
-- 실행 순서: Supabase SQL Editor → New query → 전체 붙여넣기 → Run
-- ============================================================

-- 1. 브리지 컬럼: hosting-manager 쪽에서 패드 키로 매핑할 수 있게.
--    Prisma schema 의 @unique 와 매칭되는 명명 규칙 (properties_welcomepad_key_key).
--    Postgres 는 NULL 들을 동등 비교에서 distinct 로 취급해 일반 unique 인덱스로
--    충분 (partial index WHERE NOT NULL 은 redundant).
ALTER TABLE "properties"
    ADD COLUMN IF NOT EXISTS "welcomepad_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "properties_welcomepad_key_key"
    ON "properties" ("welcomepad_key");

-- 2. 사이드카 테이블 — hosting-manager Property와 1:1
CREATE TABLE IF NOT EXISTS "welcomepad_configs" (
    "property_id"      TEXT        PRIMARY KEY REFERENCES "properties"("id") ON DELETE CASCADE,
    "hotel_name"       TEXT,
    "logo_type"        TEXT        NOT NULL DEFAULT 'text',
    "logo_image"       TEXT,
    "theme"            TEXT,
    "theme_gradient"   TEXT,
    "wifi_ssid"        TEXT,
    "wifi_password"    TEXT,
    "wifi_encryption"  TEXT        NOT NULL DEFAULT 'WPA',
    "cleaning_mode"    BOOLEAN     NOT NULL DEFAULT FALSE,
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at 자동 갱신 (welcomepad_property에 있던 트리거 함수 재사용)
DROP TRIGGER IF EXISTS trg_welcomepad_configs_updated_at ON "welcomepad_configs";
CREATE TRIGGER trg_welcomepad_configs_updated_at
    BEFORE UPDATE ON "welcomepad_configs"
    FOR EACH ROW EXECUTE FUNCTION welcomepad_set_updated_at();

-- 3. 브리지 백필 — 이름 매칭으로 welcomepad_key 채우기
--    (Property.name 한글 표시명이 welcomepad_property.label과 동일)
UPDATE "properties" SET "welcomepad_key" = 'anon'       WHERE "name" = '안온재'   AND "welcomepad_key" IS NULL;
UPDATE "properties" SET "welcomepad_key" = 'unwadang'   WHERE "name" = '운와당'   AND "welcomepad_key" IS NULL;
UPDATE "properties" SET "welcomepad_key" = 'hwayeonjae' WHERE "name" = '화연재'   AND "welcomepad_key" IS NULL;
UPDATE "properties" SET "welcomepad_key" = 'dowonjae'   WHERE "name" = '도원재'   AND "welcomepad_key" IS NULL;

-- 4. 데이터 이관: welcomepad_property → welcomepad_configs
--    (브리지가 채워진 properties 행에 한해)
INSERT INTO "welcomepad_configs" (
    "property_id", "hotel_name", "logo_type", "logo_image",
    "theme", "theme_gradient",
    "wifi_ssid", "wifi_password", "wifi_encryption",
    "cleaning_mode", "updated_at"
)
SELECT
    p."id",
    w."hotel_name",
    COALESCE(w."logo_type", 'text'),
    w."logo_image",
    w."theme",
    w."theme_gradient",
    w."wifi_ssid",
    w."wifi_password",
    COALESCE(w."wifi_encryption", 'WPA'),
    COALESCE(w."cleaning_mode", FALSE),
    COALESCE(w."updated_at", NOW())
FROM "properties" p
JOIN "welcomepad_property" w ON p."welcomepad_key" = w."property_key"
ON CONFLICT ("property_id") DO NOTHING;

-- 4-2. 브리지가 채워졌지만 welcomepad_property 행이 없던 지점도 빈 config 행
--      을 미리 만들어둔다. 패드 admin/index 의 UPDATE 가 0 rows affected 로
--      조용히 실패하지 않도록.
INSERT INTO "welcomepad_configs" ("property_id")
SELECT p."id"
FROM "properties" p
WHERE p."welcomepad_key" IS NOT NULL
ON CONFLICT ("property_id") DO NOTHING;

-- 5. RLS — 패드는 anon 클라이언트로 직접 SELECT/UPDATE
ALTER TABLE "welcomepad_configs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon select welcomepad_configs" ON "welcomepad_configs";
CREATE POLICY "anon select welcomepad_configs" ON "welcomepad_configs"
    FOR SELECT TO anon USING (TRUE);

-- admin.html 호스트 PIN 보호 화면에서 설정 변경 (logo/theme/wifi/hotel_name).
-- 패드 자체에서도 cleaning_mode 토글을 anon 권한으로 ON/OFF.
DROP POLICY IF EXISTS "anon update welcomepad_configs" ON "welcomepad_configs";
CREATE POLICY "anon update welcomepad_configs" ON "welcomepad_configs"
    FOR UPDATE TO anon USING (TRUE) WITH CHECK (TRUE);

-- properties 자체는 hosting-manager의 인증 모델로만 변경되어야 하므로
-- anon SELECT만 허용 (welcomepad_key + name 조회용). 이미 RLS off라면
-- 그대로 두고, on 상태라면 SELECT 정책 추가.
-- 현 hosting-manager는 properties에 RLS off → 별도 정책 불필요.
-- (앞으로 hosting-manager가 RLS를 켤 경우 anon SELECT 정책을 함께 추가할 것)

-- 6. Realtime — 패드/admin이 변경사항 실시간 반영
ALTER PUBLICATION supabase_realtime ADD TABLE "welcomepad_configs";

-- 7. 검증 쿼리 (마이그레이션 직후 결과 확인용)
-- SELECT p.id, p.name, p.welcomepad_key, c.hotel_name, c.cleaning_mode, c.wifi_ssid
--   FROM properties p
--   LEFT JOIN welcomepad_configs c ON c.property_id = p.id
--  WHERE p.welcomepad_key IS NOT NULL
--  ORDER BY p.welcomepad_key;
