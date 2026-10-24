-- Review artifact: 2026-10-05. This file has not been applied to production.
-- Apply only after verifying the target database, a restorable backup, and a maintenance window.
-- Execute the whole file with stop-on-error enabled; issue ROLLBACK on the same connection after any error.
-- Only these five migrations are recorded; other pending migrations and historical checksums remain untouched.
-- Source hashes use each original migration's UTF-8 bytes with CRLF normalized to LF, retaining final newlines.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL search_path = public, pg_catalog, pg_temp;
SELECT pg_catalog.pg_advisory_xact_lock(2147346411, 20261005);

DO $prerequisites$
DECLARE expected RECORD;
BEGIN
  FOR expected IN SELECT unnest(ARRAY['properties','guests','tour_bookings','_prisma_migrations']) AS name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=expected.name AND c.relkind IN ('r','p')) THEN
      RAISE EXCEPTION 'Repair refused: required public table % is absent', expected.name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'Repair refused: PostgreSQL gen_random_uuid() is unavailable';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('id','character varying','NO'), ('checksum','character varying','NO'),
    ('finished_at','timestamp with time zone','YES'), ('migration_name','character varying','NO'),
    ('logs','text','YES'), ('rolled_back_at','timestamp with time zone','YES'),
    ('started_at','timestamp with time zone','NO'), ('applied_steps_count','integer','NO')
  ) AS required(name,type_name,nullable) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
      AND c.table_name='_prisma_migrations' AND c.column_name=expected.name
      AND c.data_type=expected.type_name AND c.is_nullable=expected.nullable) THEN
      RAISE EXCEPTION 'Repair refused: unexpected migration history column %', expected.name;
    END IF;
  END LOOP;
END
$prerequisites$;

-- Keep migration history and the altered tour table stable until commit.
LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.tour_bookings IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE object_name TEXT;
BEGIN
  FOREACH object_name IN ARRAY ARRAY['staff_merges', 'inventory_snapshots', 'inventory_count_records', 'backend_commands', 'backend_reservation_commands', 'backend_guest_notes', 'backend_reservation_annotations'] LOOP
    IF pg_catalog.to_regclass('public.' || object_name) IS NOT NULL THEN
      RAISE EXCEPTION 'Repair refused: public.% already exists; review partial or completed application', object_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('prevent_inventory_count_changes','retain_completed_backend_command')) THEN
    RAISE EXCEPTION 'Repair refused: a target trigger function already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='tour_bookings' AND column_name IN ('requested_date','requested_time')) THEN
    RAISE EXCEPTION 'Repair refused: a requested tour column already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='tour_bookings' AND column_name='schedule_id' AND data_type='text' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'Repair refused: tour_bookings.schedule_id must currently be NOT NULL text';
  END IF;
  FOREACH object_name IN ARRAY ARRAY['properties','guests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=object_name AND a.attname='id'
      AND NOT a.attisdropped AND a.attnotnull AND a.atttypid='pg_catalog.text'::pg_catalog.regtype
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid
        AND k.contype IN ('p','u') AND k.conkey=ARRAY[a.attnum]::smallint[])) THEN
      RAISE EXCEPTION 'Repair refused: public.%.id must be a NOT NULL text primary/unique key', object_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE rolled_back_at IS NULL AND migration_name IN (
      '20260917010000_staff_merge_audit',
      '20260918010000_tour_booking_inquiries',
      '20261002010000_inventory_counts',
      '20261005010000_backend_commands',
      '20261005150000_reservation_workflows'
    )) THEN
    RAISE EXCEPTION 'Repair refused: a target migration has unfinished or completed unrolled-back history';
  END IF;
END
$preflight$;

-- Source: prisma/migrations/20260917010000_staff_merge_audit/migration.sql
-- SHA-256 (LF): 75d9446ba275ec575d6e7a50c9c06456fa9bf75007a1972ac3ecf0e1db685ca6
-- Schema only: employee rows are merged explicitly after a preview, never by name.
CREATE TABLE "staff_merges" (
    "id" TEXT NOT NULL,
    "source_user_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "cleaner_id" TEXT NOT NULL,
    "performed_by" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_merges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_merges_source_user_id_key" ON "staff_merges"("source_user_id");
CREATE INDEX "staff_merges_target_user_id_idx" ON "staff_merges"("target_user_id");
ALTER TABLE "staff_merges" ENABLE ROW LEVEL SECURITY;

-- Source: prisma/migrations/20260918010000_tour_booking_inquiries/migration.sql
-- SHA-256 (LF): 4b68871623eac1a2d2b48adc3a6db31f2519cebf773b12f56a88e0ad70a27a5c
ALTER TABLE "tour_bookings" ALTER COLUMN "schedule_id" DROP NOT NULL;
ALTER TABLE "tour_bookings" ADD COLUMN "requested_date" TEXT,
  ADD COLUMN "requested_time" TEXT;

-- Source: prisma/migrations/20261002010000_inventory_counts/migration.sql
-- SHA-256 (LF): b433ab76c7caedc12a4dafa6c761419acc45429878f0ba44a4cdadb740bd75a7
CREATE TABLE inventory_snapshots (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  items JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 100),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_count_records (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  request_hash TEXT NOT NULL,
  base_version INTEGER NOT NULL CHECK (base_version >= 0),
  version INTEGER NOT NULL CHECK (version = base_version + 1),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 30),
  result_items JSONB NOT NULL CHECK (jsonb_typeof(result_items) = 'array' AND jsonb_array_length(result_items) <= 100),
  checked_by_id TEXT NOT NULL,
  checked_by TEXT NOT NULL,
  checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX inventory_count_records_property_id_version_key ON inventory_count_records(property_id, version);
CREATE INDEX inventory_count_records_property_id_checked_at_idx ON inventory_count_records(property_id, checked_at);

CREATE FUNCTION prevent_inventory_count_changes() RETURNS trigger LANGUAGE plpgsql AS $immutable$
BEGIN
  RAISE EXCEPTION 'Inventory count records are immutable';
END;
$immutable$;
CREATE TRIGGER inventory_count_records_immutable BEFORE UPDATE OR DELETE ON inventory_count_records
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_count_changes();

ALTER TABLE inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_snapshots, inventory_count_records FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_inventory_count_changes() FROM PUBLIC;
DO $permissions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON inventory_snapshots, inventory_count_records FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON inventory_snapshots, inventory_count_records FROM authenticated;
  END IF;
END;
$permissions$;

-- Source: prisma/migrations/20261005010000_backend_commands/migration.sql
-- SHA-256 (LF): 8676c8ff4f99f6e27720eae659fe067df1e1e59f2aa0f2ed4b02fc2c0b987dcc
CREATE TABLE backend_commands (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  access_revision TEXT NOT NULL,
  organization_id TEXT,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded')),
  result_ciphertext TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP(3),
  CONSTRAINT backend_commands_actor_operation_key UNIQUE (actor_id, operation, key_hash),
  CONSTRAINT backend_commands_result_state CHECK (
    (status = 'running' AND result_ciphertext IS NULL AND completed_at IS NULL)
    OR (status = 'succeeded' AND result_ciphertext IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX backend_commands_organization_created_idx ON backend_commands(organization_id, created_at);
ALTER TABLE backend_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backend_commands FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON backend_commands FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON backend_commands FROM authenticated;
  END IF;
END $$;

CREATE FUNCTION retain_completed_backend_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'succeeded' THEN
    RAISE EXCEPTION 'Completed backend commands must be retained';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER backend_commands_retain
  BEFORE UPDATE OR DELETE ON backend_commands
  FOR EACH ROW EXECUTE FUNCTION retain_completed_backend_command();

-- Source: prisma/migrations/20261005150000_reservation_workflows/migration.sql
-- SHA-256 (LF): 8d858a0966e89a4e283dd8ef1a910e85e335fde11408bc5dbc4c6a5cd376a0c2
CREATE TABLE backend_reservation_commands (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('create','cancel')),
  key_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','sent','needs_review','confirmed','cancelled','rejected')),
  external_id TEXT,
  reservation_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id,operation,key_hash)
);
CREATE INDEX backend_reservation_commands_property_state_idx ON backend_reservation_commands(property_id,state,created_at);
CREATE TABLE backend_guest_notes (
  organization_id TEXT NOT NULL,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,guest_id)
);
CREATE TABLE backend_reservation_annotations (
  reservation_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE backend_reservation_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE backend_guest_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE backend_reservation_annotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backend_reservation_commands,backend_guest_notes,backend_reservation_annotations FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON backend_reservation_commands,backend_guest_notes,backend_reservation_annotations FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON backend_reservation_commands,backend_guest_notes,backend_reservation_annotations FROM authenticated; END IF;
END $$;

-- staff_merges originally enabled RLS without revoking inherited client TRUNCATE privileges.
REVOKE ALL ON public.staff_merges FROM PUBLIC;
DO $staff_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.staff_merges FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.staff_merges FROM authenticated;
  END IF;
END
$staff_acl$;

DO $verify$
DECLARE object_name TEXT; role_name TEXT; expected RECORD;
BEGIN
  FOREACH object_name IN ARRAY ARRAY['staff_merges', 'inventory_snapshots', 'inventory_count_records', 'backend_commands', 'backend_reservation_commands', 'backend_guest_notes', 'backend_reservation_annotations'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=object_name AND c.relkind='r' AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'Repair verification failed: missing table or RLS on %', object_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=pg_catalog.to_regclass('public.' || object_name)) THEN
      RAISE EXCEPTION 'Repair verification failed: unexpected RLS policy on %', object_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
      LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid=pg_catalog.to_regclass('public.' || object_name) AND a.grantee=0) THEN
      RAISE EXCEPTION 'Repair verification failed: PUBLIC retains privileges on %', object_name;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name)
        AND pg_catalog.has_table_privilege(role_name,'public.' || object_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Repair verification failed: client role % retains privileges on %', role_name,object_name;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tour_bookings'
      AND column_name IN ('schedule_id','requested_date','requested_time') AND data_type='text' AND is_nullable='YES') <> 3 THEN
    RAISE EXCEPTION 'Repair verification failed: tour inquiry columns';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('staff_merges','id,source_user_id,target_user_id,cleaner_id,performed_by,snapshot,created_at',0,0),
    ('inventory_snapshots','property_id,version,items,updated_at',1,2),
    ('inventory_count_records','id,property_id,request_hash,base_version,version,items,result_items,checked_by_id,checked_by,checked_at',1,4),
    ('backend_commands','id,actor_id,operation,key_hash,request_hash,access_revision,organization_id,target_id,status,result_ciphertext,created_at,completed_at',0,2),
    ('backend_reservation_commands','id,actor_id,property_id,operation,key_hash,body_hash,payload_ciphertext,state,external_id,reservation_id,created_at,updated_at',1,2),
    ('backend_guest_notes','organization_id,guest_id,note,version,updated_by,updated_at',1,1),
    ('backend_reservation_annotations','reservation_id,property_id,notes,tags,version,updated_by,updated_at',1,1)
  ) AS required(name,columns_csv,fk_count,check_count) LOOP
    IF (SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns
      WHERE table_schema='public' AND table_name=expected.name) IS DISTINCT FROM expected.columns_csv THEN
      RAISE EXCEPTION 'Repair verification failed: columns on %', expected.name;
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('public.' || expected.name)
      AND contype='p' AND convalidated) <> 1
      OR (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('public.' || expected.name)
      AND contype='f' AND convalidated) <> expected.fk_count
      OR (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('public.' || expected.name)
      AND contype='c' AND convalidated) <> expected.check_count THEN
      RAISE EXCEPTION 'Repair verification failed: constraints on %', expected.name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('staff_merges_source_user_id_key',true), ('staff_merges_target_user_id_idx',false),
    ('inventory_count_records_property_id_version_key',true), ('inventory_count_records_property_id_checked_at_idx',false),
    ('backend_commands_actor_operation_key',true), ('backend_commands_organization_created_idx',false),
    ('backend_reservation_commands_actor_id_operation_key_hash_key',true),
    ('backend_reservation_commands_property_state_idx',false)
  ) AS required(name,is_unique) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid=pg_catalog.to_regclass('public.' || expected.name)
      AND i.indisvalid AND i.indisready AND i.indisunique=expected.is_unique) THEN
      RAISE EXCEPTION 'Repair verification failed: index %', expected.name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('inventory_count_records','inventory_count_records_immutable','prevent_inventory_count_changes'),
    ('backend_commands','backend_commands_retain','retain_completed_backend_command')
  ) AS required(table_name,trigger_name,function_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE t.tgrelid=pg_catalog.to_regclass('public.' || expected.table_name)
      AND t.tgname=expected.trigger_name AND t.tgenabled='O' AND t.tgtype=27 AND NOT t.tgisinternal
      AND n.nspname='public' AND p.proname=expected.function_name AND p.pronargs=0
      AND p.prorettype='pg_catalog.trigger'::pg_catalog.regtype AND NOT p.prosecdef) THEN
      RAISE EXCEPTION 'Repair verification failed: trigger %', expected.trigger_name;
    END IF;
  END LOOP;
END
$verify$;

-- Staff ACL hardening is additional to the exact source migrations identified by these hashes.
INSERT INTO public._prisma_migrations
  (id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count)
SELECT pg_catalog.gen_random_uuid()::text, source.checksum, clock_timestamp(), source.name,
  NULL, NULL, transaction_timestamp(), 1
FROM (VALUES
  ('20260917010000_staff_merge_audit','75d9446ba275ec575d6e7a50c9c06456fa9bf75007a1972ac3ecf0e1db685ca6'),
  ('20260918010000_tour_booking_inquiries','4b68871623eac1a2d2b48adc3a6db31f2519cebf773b12f56a88e0ad70a27a5c'),
  ('20261002010000_inventory_counts','b433ab76c7caedc12a4dafa6c761419acc45429878f0ba44a4cdadb740bd75a7'),
  ('20261005010000_backend_commands','8676c8ff4f99f6e27720eae659fe067df1e1e59f2aa0f2ed4b02fc2c0b987dcc'),
  ('20261005150000_reservation_workflows','8d858a0966e89a4e283dd8ef1a910e85e335fde11408bc5dbc4c6a5cd376a0c2')
) AS source(name,checksum);

DO $verify_history$
BEGIN
  IF (SELECT count(*) FROM public._prisma_migrations WHERE rolled_back_at IS NULL
      AND finished_at IS NOT NULL AND applied_steps_count=1 AND (migration_name,checksum) IN (VALUES
        ('20260917010000_staff_merge_audit','75d9446ba275ec575d6e7a50c9c06456fa9bf75007a1972ac3ecf0e1db685ca6'),
        ('20260918010000_tour_booking_inquiries','4b68871623eac1a2d2b48adc3a6db31f2519cebf773b12f56a88e0ad70a27a5c'),
        ('20261002010000_inventory_counts','b433ab76c7caedc12a4dafa6c761419acc45429878f0ba44a4cdadb740bd75a7'),
        ('20261005010000_backend_commands','8676c8ff4f99f6e27720eae659fe067df1e1e59f2aa0f2ed4b02fc2c0b987dcc'),
        ('20261005150000_reservation_workflows','8d858a0966e89a4e283dd8ef1a910e85e335fde11408bc5dbc4c6a5cd376a0c2')
      )) <> 5 THEN
    RAISE EXCEPTION 'Repair verification failed: migration history';
  END IF;
END
$verify_history$;

COMMIT;
