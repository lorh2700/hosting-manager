-- ============================================================
-- v1 외부 파트너 API 인프라 — Phase A
--
-- 1. api_clients — 파트너사별 API key (해시만 저장) + scopes + 지점 제한
-- 2. cleanings 에 외부 source/id + 외부 cleaner 정보 컬럼 추가
--    (스테이폴리오 같은 파트너가 자체 cleaner pool 로 청소 push 할 때 사용)
--
-- 실행: Supabase SQL Editor → New query → Run
-- ============================================================

-- 1. api_clients
CREATE TABLE IF NOT EXISTS "api_clients" (
    "id"            TEXT        PRIMARY KEY,
    "name"          TEXT        NOT NULL,
    "key_prefix"    TEXT        NOT NULL,
    "key_hash"      TEXT        NOT NULL,
    "scopes"        TEXT[]      NOT NULL DEFAULT '{}',
    "property_ids"  TEXT[]      NOT NULL DEFAULT '{}',
    "expires_at"    TIMESTAMPTZ,
    "revoked_at"    TIMESTAMPTZ,
    "last_used_at"  TIMESTAMPTZ,
    "created_by"    TEXT,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_clients_key_prefix_key" ON "api_clients" ("key_prefix");
CREATE UNIQUE INDEX IF NOT EXISTS "api_clients_key_hash_key"   ON "api_clients" ("key_hash");

-- 2. cleanings 외부 source 컬럼
ALTER TABLE "cleanings"
    ADD COLUMN IF NOT EXISTS "external_source"        TEXT,
    ADD COLUMN IF NOT EXISTS "external_id"            TEXT,
    ADD COLUMN IF NOT EXISTS "external_cleaner_name"  TEXT,
    ADD COLUMN IF NOT EXISTS "external_cleaner_phone" TEXT;

-- (externalSource, externalId) 멱등성 키. 같은 파트너 + 같은 ID 면 재전송 시 update.
CREATE UNIQUE INDEX IF NOT EXISTS "cleanings_external_source_external_id_key"
    ON "cleanings" ("external_source", "external_id")
    WHERE "external_source" IS NOT NULL AND "external_id" IS NOT NULL;

-- 3. 검증
-- SELECT count(*) FROM api_clients;  -- 0
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='cleanings'
--    AND column_name LIKE 'external_%';
