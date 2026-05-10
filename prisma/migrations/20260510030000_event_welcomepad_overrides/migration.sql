-- ============================================================
-- Welcome-pad / hosting-manager — Phase 2A
--
-- welcomepad_current_guest 의 호스트 수동 override 두 컬럼을 hosting-manager
-- Event 로 옮긴다. 이로써 패드는 /api/public/welcomepad/checkins 한 곳에서
-- 게스트 정보 + 호스트 override 를 모두 받아갈 수 있게 됨.
--
--   • events.welcome_message   — host-edited welcome text (Beds24 sync 이 덮어
--                                쓰지 않음. NULL 이면 Property.room_ready_message
--                                또는 기본 문구로 폴백.)
--   • events.manual_returning  — host 가 강제로 "재방문/신규" 토글 (NULL = 자동 판정)
--
-- 마이그레이션이 끝난 후 /checkins 엔드포인트는 이 두 컬럼을 읽어 응답에
-- 포함시킨다. 패드 index.html 은 welcomepad_current_guest 대신 /checkins 에서
-- 직접 읽음 (Phase 2A).
--
-- 기존 welcomepad_current_guest 의 manual 데이터는 best-effort 백필:
-- 현재 활성 게스트 1건에 한해 매칭되는 Event 행에 옮겨 준다. 매칭 키는
-- (welcomepad_key → property_id, check_in == start_date, check_out == end_date).
-- 매칭 실패해도 마이그레이션은 통과 — 호스트가 다음에 admin.html 에서
-- 다시 토글하면 됨.
--
-- 실행: Supabase SQL Editor → Run
-- ============================================================

-- 1. 새 컬럼 추가
ALTER TABLE "events"
    ADD COLUMN IF NOT EXISTS "welcome_message"  TEXT,
    ADD COLUMN IF NOT EXISTS "manual_returning" BOOLEAN;

-- 2. welcomepad_current_guest 의 호스트 override 를 매칭 가능한 Event 로 백필
--    (welcomepad_property 의 cleaning_mode/wifi 등은 Phase 1 에서 옮겼고,
--     여기서는 manual_returning 과 welcome_message 만 다룸.)
--    매칭 못 찾으면 조용히 스킵.
UPDATE "events" e
   SET "manual_returning" = cg."manual_returning",
       "welcome_message"  = cg."welcome_message"
  FROM "welcomepad_current_guest" cg
  JOIN "properties" p ON p."welcomepad_key" = cg."property_key"
 WHERE e."property_id" = p."id"
   AND e."start_date"  = COALESCE(cg."check_in"::text, e."start_date")
   AND e."end_date"    = COALESCE(cg."check_out"::text, e."end_date")
   AND e."type"        = 'reservation'
   AND e."channel_id"  = 'beds24'
   AND (cg."manual_returning" IS NOT NULL OR cg."welcome_message" IS NOT NULL);

-- 3. 검증 쿼리 (마이그레이션 직후)
-- SELECT e.id, p.welcomepad_key, e.start_date, e.end_date, e.welcome_message, e.manual_returning
--   FROM events e
--   JOIN properties p ON p.id = e.property_id
--  WHERE p.welcomepad_key IS NOT NULL
--    AND (e.welcome_message IS NOT NULL OR e.manual_returning IS NOT NULL)
--  ORDER BY p.welcomepad_key, e.start_date;
