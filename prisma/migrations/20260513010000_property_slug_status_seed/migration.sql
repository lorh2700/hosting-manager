-- ============================================================
-- Property.slug / status / openingDate 추가 + 별하재/자락헌 신규 시드
--
-- 목적:
--   • 공개 URL 을 UUID 대신 슬러그로 (/book/anon, /book/byeolha 등)
--   • 오픈 예정 상태 지원 (자락헌 = 2026-10 오픈)
--   • 새 지점 2개 (별하재, 자락헌) 시드
--
-- 실행: Supabase SQL Editor → New query → Run
-- ============================================================

-- 1. 컬럼 추가
ALTER TABLE "properties"
    ADD COLUMN IF NOT EXISTS "slug"         TEXT,
    ADD COLUMN IF NOT EXISTS "status"       TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS "opening_date" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "properties_slug_key" ON "properties" ("slug");

-- 2. 기존 4지점 slug 백필 (welcomepad_key 와 동일 값)
UPDATE "properties" SET "slug" = 'anon'       WHERE "name" = '안온재'   AND "slug" IS NULL;
UPDATE "properties" SET "slug" = 'unwadang'   WHERE "name" = '운와당'   AND "slug" IS NULL;
UPDATE "properties" SET "slug" = 'hwayeonjae' WHERE "name" = '화연재'   AND "slug" IS NULL;
UPDATE "properties" SET "slug" = 'dowonjae'   WHERE "name" = '도원재'   AND "slug" IS NULL;

-- 3. 새 지점 시드 — 별하재 (active), 자락헌 (coming_soon).
--    owner_id 는 첫 번째 super_admin 을 사용.
--    beds24_prop_id, welcomepad_key 등은 나중에 admin UI 에서 채움.
DO $$
DECLARE
    v_owner_id text;
BEGIN
    SELECT id INTO v_owner_id
      FROM users
     WHERE role = 'super_admin'
     ORDER BY created_at ASC
     LIMIT 1;

    IF v_owner_id IS NULL THEN
        SELECT id INTO v_owner_id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'No super_admin/admin user found — cannot seed properties';
    END IF;

    -- 별하재 — 이번 오픈
    INSERT INTO "properties" (
        "id", "name", "timezone", "owner_id",
        "max_guests", "description",
        "slug", "status"
    )
    SELECT gen_random_uuid(), '별하재', 'Asia/Seoul', v_owner_id,
           6, '서울 종로구 북촌로5나길 7-4',
           'byeolha', 'active'
    WHERE NOT EXISTS (SELECT 1 FROM "properties" WHERE "slug" = 'byeolha');

    -- 자락헌 — 2026-10 오픈 예정
    INSERT INTO "properties" (
        "id", "name", "timezone", "owner_id",
        "max_guests", "description",
        "slug", "status", "opening_date"
    )
    SELECT gen_random_uuid(), '자락헌', 'Asia/Seoul', v_owner_id,
           4, '서울 종로구 북촌로15길 37',
           'jarakheon', 'coming_soon', '2026-10'
    WHERE NOT EXISTS (SELECT 1 FROM "properties" WHERE "slug" = 'jarakheon');
END $$;

-- 4. 검증
-- SELECT slug, name, status, opening_date, max_guests
--   FROM properties
--  WHERE slug IS NOT NULL
--  ORDER BY status DESC, slug;
-- 예상: 5개 활성 (anon, byeolha, dowonjae, hwayeonjae, unwadang) + 1개 coming_soon (jarakheon)
