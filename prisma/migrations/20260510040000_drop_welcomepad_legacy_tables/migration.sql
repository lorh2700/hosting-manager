-- ============================================================
-- Welcome-pad / hosting-manager — Phase 2B
--
-- Phase 2A 가 패드 (index.html) 의 게스트 데이터 소스를 hosting-manager Event
-- 로 전환했고, Phase 2B 가 admin.html 의 호스트 override 흐름까지 옮겼다.
-- 이로써 다음 두 테이블은 더 이상 사용처가 없다:
--
--   • welcomepad_current_guest  (지점당 1행, 오늘 활성 게스트의 캐시 + 호스트 override)
--   • welcomepad_guest_history  (수동 등록한 게스트의 append-only 기록)
--
-- 호스트 override (welcome_message, manual_returning) 는 events 테이블의
-- 새 컬럼으로 옮겨졌고 (Phase 2A 마이그레이션), Beds24 mirror 는 events 가
-- 단일 소스라 별도 캐시가 불필요.
--
-- ⚠ 적용 전 확인:
--   1. 패드 배포 (index.html — get-active-guest Netlify 함수 사용 중)
--   2. admin 배포 (admin.html — set-event-override Netlify 함수 사용 중)
--   3. /api/public/welcomepad/checkins 가 propertyKey 모드로 응답하는지
--   4. /api/public/welcomepad/active-event-override POST 가 동작하는지
--
-- 모두 OK 면 이 마이그레이션 실행.
--
-- 실행: Supabase SQL Editor → New query → 전체 붙여넣기 → Run
-- ============================================================

-- 1. welcomepad_get_or_create_active_thread Postgres 함수 재정의.
--    이전 정의가 welcomepad_current_guest 를 SELECT 했기에 drop 전에 새
--    정의로 교체 필요. 새 정의는 hosting-manager 의 properties + events 에서
--    오늘 활성 예약을 직접 조회해 스냅샷을 만든다.
CREATE OR REPLACE FUNCTION welcomepad_get_or_create_active_thread(p_property_key text)
RETURNS bigint AS $$
DECLARE
    v_thread_id bigint;
    v_property_id text;
    v_event record;
BEGIN
    -- 이미 활성 스레드가 있으면 그대로 반환
    SELECT id INTO v_thread_id
      FROM welcomepad_message_threads
     WHERE property_key = p_property_key
       AND is_active = true
     LIMIT 1;
    IF v_thread_id IS NOT NULL THEN RETURN v_thread_id; END IF;

    -- 활성 스레드 없음 → hosting-manager 에서 오늘 활성 예약 스냅샷.
    SELECT id INTO v_property_id
      FROM properties
     WHERE welcomepad_key = p_property_key
     LIMIT 1;

    IF v_property_id IS NOT NULL THEN
        -- 오늘 시작 ≤ today ≤ 종료 인 beds24 reservation 1건
        -- (진행중인 stay 우선, 그 다음 오늘 체크아웃)
        SELECT title, start_date::text AS check_in, end_date::text AS check_out INTO v_event
          FROM events
         WHERE property_id = v_property_id
           AND channel_id = 'beds24'
           AND type = 'reservation'
           AND start_date <= to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
           AND end_date   >= to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
         ORDER BY (CASE WHEN end_date > to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') THEN 0 ELSE 1 END)
         LIMIT 1;
    END IF;

    INSERT INTO welcomepad_message_threads (property_key, guest_name, check_in, check_out, is_active)
    VALUES (
        p_property_key,
        v_event.title,
        CASE WHEN v_event.check_in IS NOT NULL THEN v_event.check_in::date ELSE NULL END,
        CASE WHEN v_event.check_out IS NOT NULL THEN v_event.check_out::date ELSE NULL END,
        true
    )
    RETURNING id INTO v_thread_id;

    RETURN v_thread_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Realtime publication 에서 제거 (DROP TABLE 전에 필수)
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS "welcomepad_current_guest";
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS "welcomepad_guest_history";

-- 3. 테이블 drop. CASCADE 는 RLS 정책/트리거가 자동 정리되도록 명시.
--    (welcomepad_get_or_create_active_thread 가 위에서 새 정의로 교체됐으니
--    더 이상 이 테이블을 참조하지 않음.)
DROP TABLE IF EXISTS "welcomepad_guest_history" CASCADE;
DROP TABLE IF EXISTS "welcomepad_current_guest" CASCADE;

-- 3. 검증 쿼리
-- SELECT table_name
--   FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name LIKE 'welcomepad_%'
--  ORDER BY table_name;
-- 예상 결과:
--   welcomepad_configs
--   welcomepad_events
--   welcomepad_host_devices
--   welcomepad_message_threads
--   welcomepad_messages
--   welcomepad_property         ← 다른 welcomepad_* 의 FK 대상이라 stub 으로 유지
--   welcomepad_weather          ← 패드가 직접 SELECT 중 (Phase 3 후보)
