-- ─────────────────────────────────────────────────────────────────
-- 아띠인력거 투어 시드 데이터
-- 실행: Supabase SQL Editor 에 전체 복사 붙여넣고 RUN
-- 멱등성: name='아띠인력거' 운영업체가 이미 있으면 중복 생성 방지
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_owner_id      TEXT;
  v_operator_id   TEXT;
  v_tour_short_id TEXT;
  v_tour_landmark_id TEXT;
  v_tour_vip_id   TEXT;
BEGIN
  -- ── 1. 첫 admin/super_admin 유저를 owner 로 사용 ─────────────────
  SELECT id INTO v_owner_id
  FROM users
  WHERE role IN ('super_admin', 'admin')
  ORDER BY created_at
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'No admin user found — log in once as super_admin first';
  END IF;

  -- ── 2. 운영업체 (이미 있으면 그 id 재사용) ────────────────────────
  SELECT id INTO v_operator_id
  FROM tour_operators
  WHERE name = '아띠인력거' AND owner_id = v_owner_id
  LIMIT 1;

  IF v_operator_id IS NULL THEN
    v_operator_id := gen_random_uuid()::TEXT;
    INSERT INTO tour_operators (id, owner_id, name, notify_channel, public_token, created_at)
    VALUES (v_operator_id, v_owner_id, '아띠인력거', 'kakao', gen_random_uuid()::TEXT, NOW());
  END IF;

  -- ── 3. 투어 1: 1시간 북촌한옥 옛길 ────────────────────────────────
  SELECT id INTO v_tour_short_id
  FROM tours
  WHERE slug = 'attyrickshaw-bukchon-1h';

  IF v_tour_short_id IS NULL THEN
    v_tour_short_id := gen_random_uuid()::TEXT;
    INSERT INTO tours (
      id, owner_id, operator_id, title, slug, category, description,
      meeting_point, duration_min, max_group_size, images, is_active,
      created_at, updated_at
    ) VALUES (
      v_tour_short_id, v_owner_id, v_operator_id,
      '북촌한옥 옛길', 'attyrickshaw-bukchon-1h', 'guide',
      E'60분 인력거 코스. 북촌·한옥마을 핵심을 한 번에 둘러봅니다.\n서울 첫 방문에 추천.\n\n코스: 감고당길 → 사간동 골목길 → 경복궁 건춘문 → 국립현대미술관 → 북촌한옥마을 → 헌법재판소 → 윤보선가\n\n* 일요일은 북촌 출입 제한으로 대체 코스 진행 (창덕궁 돌담길 등)\n* 6시간 전 사전 예약 필수',
      '안국역 1번 출구', 60, 2, ARRAY[]::TEXT[], TRUE,
      NOW(), NOW()
    );

    INSERT INTO tour_ticket_tiers (id, tour_id, label, price, notes, sort_order, created_at) VALUES
      (gen_random_uuid()::TEXT, v_tour_short_id, '성인',   65000,    NULL,      0, NOW()),
      (gen_random_uuid()::TEXT, v_tour_short_id, '어린이', 32500,    '4-7세',   1, NOW()),
      (gen_random_uuid()::TEXT, v_tour_short_id, '영유아', 0,        '무료',    2, NOW());
  END IF;

  -- ── 4. 투어 2: 1.5시간 서울랜드마크 ──────────────────────────────
  SELECT id INTO v_tour_landmark_id
  FROM tours
  WHERE slug = 'attyrickshaw-landmark-90m';

  IF v_tour_landmark_id IS NULL THEN
    v_tour_landmark_id := gen_random_uuid()::TEXT;
    INSERT INTO tours (
      id, owner_id, operator_id, title, slug, category, description,
      meeting_point, duration_min, max_group_size, images, is_active,
      created_at, updated_at
    ) VALUES (
      v_tour_landmark_id, v_owner_id, v_operator_id,
      '서울랜드마크', 'attyrickshaw-landmark-90m', 'guide',
      E'90분 인력거 코스. 경복궁·청와대·삼청동 중심.\n걷기엔 멀고 차로는 놓치는 서울의 핵심 랜드마크를 한 번에.\n\n코스: 인사동 → 청계천 → 광화문광장 → 경복궁 → 청와대 → 삼청동 → 국립현대미술관\n\n* 6시간 전 사전 예약 필수',
      '안국역 1번 출구', 90, 2, ARRAY[]::TEXT[], TRUE,
      NOW(), NOW()
    );

    INSERT INTO tour_ticket_tiers (id, tour_id, label, price, notes, sort_order, created_at) VALUES
      (gen_random_uuid()::TEXT, v_tour_landmark_id, '성인',   90000,    NULL,      0, NOW()),
      (gen_random_uuid()::TEXT, v_tour_landmark_id, '어린이', 45000,    '4-7세',   1, NOW()),
      (gen_random_uuid()::TEXT, v_tour_landmark_id, '영유아', 0,        '무료',    2, NOW());
  END IF;

  -- ── 5. 투어 3: 2시간 북촌한옥 VIP ────────────────────────────────
  SELECT id INTO v_tour_vip_id
  FROM tours
  WHERE slug = 'attyrickshaw-bukchon-vip-2h';

  IF v_tour_vip_id IS NULL THEN
    v_tour_vip_id := gen_random_uuid()::TEXT;
    INSERT INTO tours (
      id, owner_id, operator_id, title, slug, category, description,
      meeting_point, duration_min, max_group_size, images, is_active,
      created_at, updated_at
    ) VALUES (
      v_tour_vip_id, v_owner_id, v_operator_id,
      '북촌한옥 VIP', 'attyrickshaw-bukchon-vip-2h', 'guide',
      E'120분 인력거 프리미엄 코스. 한옥 내부 체험 포함.\n사진·체험·스토리를 모두 원하는 분께 추천.\n\n코스: 감고당길 → 사간동 골목길 → 경복궁 건춘문 → 국립현대미술관 → 북촌한옥마을 → 삼청동 → 계동길 → 창덕궁 돌담길 → 원서동 빨래터 → 고희동\n\n* 일요일은 북촌 출입 제한으로 대체 코스 진행\n* 6시간 전 사전 예약 필수',
      '안국역 1번 출구', 120, 2, ARRAY[]::TEXT[], TRUE,
      NOW(), NOW()
    );

    INSERT INTO tour_ticket_tiers (id, tour_id, label, price, notes, sort_order, created_at) VALUES
      (gen_random_uuid()::TEXT, v_tour_vip_id, '성인',   110000,   NULL,      0, NOW()),
      (gen_random_uuid()::TEXT, v_tour_vip_id, '어린이', 55000,    '4-7세',   1, NOW()),
      (gen_random_uuid()::TEXT, v_tour_vip_id, '영유아', 0,        '무료',    2, NOW());
  END IF;

  RAISE NOTICE 'Seed completed. Operator: %, Tours: 3, Tiers: 9', v_operator_id;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- 확인 쿼리 (위 DO 실행 후 따로 RUN)
-- ─────────────────────────────────────────────────────────────────
SELECT
  t.title,
  t.slug,
  t.duration_min,
  t.max_group_size,
  t.is_active,
  COUNT(tt.id) AS tier_count,
  STRING_AGG(tt.label || ' ' || tt.price::INT || '원', ' / ' ORDER BY tt.sort_order) AS tiers
FROM tours t
LEFT JOIN tour_ticket_tiers tt ON tt.tour_id = t.id
WHERE t.slug LIKE 'attyrickshaw-%'
GROUP BY t.id, t.title, t.slug, t.duration_min, t.max_group_size, t.is_active, t.created_at
ORDER BY t.created_at;
