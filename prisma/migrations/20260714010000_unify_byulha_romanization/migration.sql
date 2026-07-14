-- ============================================================
-- 별하재 로마자 표기 통일 (byeolha → byulha) + 웰컴패드 브리지 연결
--
-- 별하재 Property 행은 20260513010000_property_slug_status_seed 에서 이미
-- slug = 'byeolha' 로 시드됐다. 그 마이그레이션은 적용 완료라 수정하면 체크섬이
-- 깨진다 — 리네임은 여기(새 마이그레이션)에서 UPDATE 로 한다.
--
--   properties.slug           = 'byulha'   ← 공개 URL (voidanchae.com/book/byulha)
--   properties.welcomepad_key = 'byulha'   ← 패드 URL (unwa.netlify.app/?p=byulha)
--
-- 구 URL /book/byeolha 는 next.config.ts 의 영구 리다이렉트로 살려 둔다.
-- 짝을 이루는 패드 마이그레이션: hotel-welcome-pad/supabase/migrations/005_add_byulha.sql
--
-- 실행: Supabase SQL Editor → New query → 전체 붙여넣기 → Run
-- ============================================================

-- 1. slug 리네임과 브리지 키 부여를 한 UPDATE 로 함께 처리.
--    ⚠ 두 문장으로 나누면 안 된다 — slug 를 먼저 바꾸면 뒤따르는
--      WHERE slug = 'byeolha' 가 0 rows 가 되어 welcomepad_key 가 조용히 안 붙는다.
--    slug / welcomepad_key 둘 다 UNIQUE 이므로 이미 byulha 행이 있으면 건너뛴다
--    (재실행 안전 가드. 서브쿼리는 UPDATE 이전 스냅샷을 보므로 self-reference 안전).
UPDATE "properties"
   SET "slug"           = 'byulha',
       "welcomepad_key" = 'byulha'
 WHERE "slug" = 'byeolha'
   AND NOT EXISTS (SELECT 1 FROM "properties" WHERE "slug" = 'byulha');

-- 2. 빈 welcomepad_configs 행 — 패드 admin 의 UPDATE 가 0 rows affected 로
--    조용히 실패하지 않도록 미리 만들어 둔다
--    (20260510020000_welcomepad_property_merge 의 4-2 블록과 같은 이유).
INSERT INTO "welcomepad_configs" ("property_id")
SELECT p."id"
  FROM "properties" p
 WHERE p."welcomepad_key" = 'byulha'
ON CONFLICT ("property_id") DO NOTHING;

-- 3. 검증
-- SELECT p.slug, p.name, p.welcomepad_key, p.status, c.property_id IS NOT NULL AS has_config
--   FROM properties p
--   LEFT JOIN welcomepad_configs c ON c.property_id = p.id
--  WHERE p.welcomepad_key IS NOT NULL
--  ORDER BY p.welcomepad_key;
-- 예상: byulha 행이 slug='byulha', status='active', has_config=true
-- SELECT count(*) FROM properties WHERE slug = 'byeolha';   → 0 이어야 함
