BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;

DO $apply_stay_services$
DECLARE
  target_database CONSTANT text := 'hosting_manager_cutover_20261030';
  target_migration CONSTANT text := '20261101010000_reservation_stay_services';
  target_checksum CONSTANT text := '9a2861a04494d0b73c18db6b5331bd440cd85c1f00b811dcabadc82cb560f88f';
  expected_owner text := current_setting('stay_services.verified_table_owner', true);
  expected_api_user text := current_setting('stay_services.verified_api_user', true);
  private_owner text;
  api_role_oid oid;
  api_policy CONSTANT text := 'hosting_manager_app_runtime_v1';
  target_tables CONSTANT text[] := ARRAY['backend_reservation_pickups'];
  table_name text;
  table_oid oid;
  migration_count integer;
  existing_checksum text;
  existing_finished_at timestamptz;
  existing_rolled_back_at timestamptz;
  existing_applied_steps integer;
  started_at timestamptz := clock_timestamp();
  migration_sql CONSTANT text := $stay_services_sql$ALTER TABLE cleanings ADD COLUMN reservation_id TEXT;
CREATE INDEX cleanings_property_id_reservation_id_idx ON cleanings(property_id, reservation_id);

UPDATE cleanings c SET reservation_id = linked.reservation_id
FROM (
  SELECT target_id, property_id, min(details->>'reservationId') AS reservation_id
  FROM audit_logs
  WHERE action = 'cleaning.interim.create' AND target_type = 'cleaning'
    AND details->>'reservationId' ~ '^(event|booking):[A-Za-z0-9_-]{1,90}$'
  GROUP BY target_id, property_id
  HAVING count(DISTINCT details->>'reservationId') = 1
) linked
WHERE c.id = linked.target_id AND c.property_id = linked.property_id AND c.origin = 'interim'
  AND c.reservation_id IS NULL;

CREATE TABLE backend_reservation_pickups (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reservation_key TEXT NOT NULL,
  reservation_id TEXT NOT NULL CHECK (reservation_id ~ '^(event|booking):[A-Za-z0-9_-]{1,90}$'),
  arrival JSONB,
  departure JSONB,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (property_id, reservation_key),
  CHECK (arrival IS NULL OR jsonb_typeof(arrival) = 'object'),
  CHECK (departure IS NULL OR jsonb_typeof(departure) = 'object')
);
CREATE INDEX backend_reservation_pickups_reservation_idx ON backend_reservation_pickups(property_id, reservation_id);
ALTER TABLE backend_reservation_pickups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backend_reservation_pickups FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON backend_reservation_pickups FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON backend_reservation_pickups FROM authenticated;
  END IF;
END $$;
$stay_services_sql$;
BEGIN
  IF current_database() <> target_database THEN
    RAISE EXCEPTION 'stay_services_wrong_database: %', current_database();
  END IF;
  IF encode(sha256(convert_to(migration_sql, 'UTF8')), 'hex') <> target_checksum THEN
    RAISE EXCEPTION 'stay_services_embedded_migration_checksum_mismatch';
  END IF;
  IF expected_owner IS NULL OR expected_owner = '' OR expected_api_user IS NULL OR expected_api_user = '' THEN
    RAISE EXCEPTION 'stay_services_requires_verified_table_owner_and_api_user';
  END IF;
  IF expected_owner IN ('anon', 'authenticated', 'PUBLIC')
    OR expected_api_user IN ('anon', 'authenticated', 'PUBLIC') OR expected_api_user = expected_owner THEN
    RAISE EXCEPTION 'stay_services_requires_separate_private_api_role';
  END IF;
  SELECT oid INTO api_role_oid FROM pg_roles
    WHERE rolname = expected_api_user AND NOT rolsuper AND NOT rolbypassrls;
  IF api_role_oid IS NULL THEN
    RAISE EXCEPTION 'stay_services_missing_or_privileged_api_role';
  END IF;

  FOREACH table_name IN ARRAY ARRAY['users', 'properties', 'cleanings', 'audit_logs', '_prisma_migrations', 'backend_commands'] LOOP
    SELECT c.oid INTO table_oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relkind = 'r';
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'stay_services_missing_prerequisite: %', table_name;
    END IF;
    IF table_name IN ('users', 'properties', 'cleanings') AND NOT EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = table_oid AND attname = 'id'
        AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'stay_services_invalid_reference_id: %', table_name;
    END IF;
  END LOOP;
  SELECT pg_get_userbyid(relowner) INTO STRICT private_owner
    FROM pg_class WHERE oid = 'public.backend_commands'::regclass;
  IF private_owner <> expected_owner THEN
    RAISE EXCEPTION 'stay_services_private_owner_mismatch: %', private_owner;
  END IF;
  IF pg_has_role(api_role_oid, (SELECT relowner FROM pg_class WHERE oid = 'public.backend_commands'::regclass), 'USAGE') THEN
    RAISE EXCEPTION 'stay_services_api_role_inherits_table_owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('id', 'character varying'), ('checksum', 'character varying'),
      ('migration_name', 'character varying'), ('started_at', 'timestamp with time zone'),
      ('finished_at', 'timestamp with time zone'), ('rolled_back_at', 'timestamp with time zone'),
      ('applied_steps_count', 'integer'), ('logs', 'text')) AS required(column_name, type_name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = 'public._prisma_migrations'::regclass AND a.attname = required.column_name
        AND format_type(a.atttypid, NULL) = required.type_name AND NOT a.attisdropped)
  ) THEN
    RAISE EXCEPTION 'stay_services_invalid_migration_history_schema';
  END IF;

  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO migration_count FROM public._prisma_migrations WHERE migration_name = target_migration;
  IF migration_count > 1 THEN
    RAISE EXCEPTION 'stay_services_ambiguous_migration_history';
  END IF;
  IF migration_count = 1 THEN
    SELECT checksum, finished_at, rolled_back_at, applied_steps_count
      INTO existing_checksum, existing_finished_at, existing_rolled_back_at, existing_applied_steps
      FROM public._prisma_migrations WHERE migration_name = target_migration;
    IF existing_checksum IS DISTINCT FROM target_checksum THEN
      RAISE EXCEPTION 'stay_services_applied_checksum_mismatch';
    END IF;
    IF existing_finished_at IS NULL OR existing_rolled_back_at IS NOT NULL OR existing_applied_steps IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'stay_services_incomplete_migration_history';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.cleanings'::regclass
      AND attname = 'reservation_id' AND NOT attisdropped) THEN
      RAISE EXCEPTION 'stay_services_preexisting_cleaning_link_without_history';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(target_tables))
      OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = ANY(target_tables)) THEN
      RAISE EXCEPTION 'stay_services_preexisting_objects_without_history';
    END IF;
    EXECUTE migration_sql;
    FOREACH table_name IN ARRAY target_tables LOOP
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', table_name, expected_owner);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, expected_api_user);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', table_name, expected_api_user);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
        api_policy, table_name, expected_api_user);
    END LOOP;
  END IF;

  FOREACH table_name IN ARRAY target_tables LOOP
    SELECT c.oid INTO table_oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relkind = 'r'
        AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner) = expected_owner;
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'stay_services_private_table_state_mismatch: %', table_name;
    END IF;
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = table_oid) <> 1
      OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = table_oid AND polname = api_policy
        AND polcmd = '*' AND polpermissive AND polroles = ARRAY[api_role_oid]
        AND pg_get_expr(polqual, polrelid) = 'true' AND pg_get_expr(polwithcheck, polrelid) = 'true') THEN
      RAISE EXCEPTION 'stay_services_api_policy_mismatch: %', table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
        WHERE c.oid = table_oid AND acl.grantee = 0)
      OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
        AND has_table_privilege(r.oid, table_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
      RAISE EXCEPTION 'stay_services_browser_access_or_policy_exists: %', table_name;
    END IF;
    IF NOT has_table_privilege(api_role_oid, table_oid, 'SELECT')
      OR NOT has_table_privilege(api_role_oid, table_oid, 'INSERT')
      OR NOT has_table_privilege(api_role_oid, table_oid, 'UPDATE')
      OR NOT has_table_privilege(api_role_oid, table_oid, 'DELETE')
      OR has_table_privilege(api_role_oid, table_oid, 'TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'stay_services_api_privilege_mismatch: %', table_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.cleanings'::regclass
    AND attname = 'reservation_id' AND atttypid = 'text'::regtype AND NOT attnotnull AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND tablename = 'cleanings' AND indexname = 'cleanings_property_id_reservation_id_idx'
      AND indexdef LIKE '%(property_id, reservation_id)%') THEN
    RAISE EXCEPTION 'stay_services_cleaning_link_state_mismatch';
  END IF;

  IF migration_count = 0 THEN
    INSERT INTO public._prisma_migrations
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
    VALUES (gen_random_uuid()::text, target_checksum, clock_timestamp(), target_migration, NULL, NULL, started_at, 1);
    RAISE NOTICE 'stay_services_migration_applied: %', target_migration;
  ELSE
    RAISE NOTICE 'stay_services_migration_already_applied: %', target_migration;
  END IF;
END
$apply_stay_services$;
COMMIT;
