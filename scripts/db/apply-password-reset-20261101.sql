BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;

DO $apply_password_reset$
DECLARE
  target_database CONSTANT text := 'hosting_manager_cutover_20261030';
  target_migration CONSTANT text := '20261101020000_password_reset';
  target_checksum CONSTANT text := '72f076ace1b96a0cefdb586bc6578df00712aa2fcf7653e206c2070f716e45d2';
  expected_owner text := current_setting('password_reset.verified_table_owner', true);
  expected_api_user text := current_setting('password_reset.verified_api_user', true);
  private_owner text;
  api_role_oid oid;
  api_policy CONSTANT text := 'hosting_manager_app_runtime_v1';
  target_tables CONSTANT text[] := ARRAY['password_reset_requests', 'password_reset_limits'];
  table_name text;
  table_oid oid;
  migration_count integer;
  existing_checksum text;
  existing_finished_at timestamptz;
  existing_rolled_back_at timestamptz;
  existing_applied_steps integer;
  started_at timestamptz := clock_timestamp();
  migration_sql CONSTANT text := $password_reset_sql$ALTER TABLE users ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0 CHECK (credential_version >= 0);

CREATE TABLE password_reset_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  credential_version INTEGER CHECK (credential_version >= 0),
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'sent', 'failed', 'ignored')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  completed_version INTEGER CHECK (completed_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((consumed_at IS NULL) = (completed_version IS NULL))
);
CREATE INDEX password_reset_requests_email_idx ON password_reset_requests(email, created_at DESC);
CREATE INDEX password_reset_requests_user_idx ON password_reset_requests(user_id);
CREATE INDEX password_reset_requests_expiry_idx ON password_reset_requests(expires_at);

CREATE TABLE password_reset_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  last_request_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);

ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON password_reset_requests, password_reset_limits FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON password_reset_requests, password_reset_limits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON password_reset_requests, password_reset_limits FROM authenticated;
  END IF;
END $$;
$password_reset_sql$;
BEGIN
  IF current_database() <> target_database THEN
    RAISE EXCEPTION 'password_reset_wrong_database: %', current_database();
  END IF;
  IF encode(sha256(convert_to(migration_sql, 'UTF8')), 'hex') <> target_checksum THEN
    RAISE EXCEPTION 'password_reset_embedded_migration_checksum_mismatch';
  END IF;
  IF expected_owner IS NULL OR expected_owner = '' OR expected_api_user IS NULL OR expected_api_user = '' THEN
    RAISE EXCEPTION 'password_reset_requires_verified_table_owner_and_api_user';
  END IF;
  IF expected_owner <> 'postgres' OR expected_api_user <> 'hosting_manager_app' THEN
    RAISE EXCEPTION 'password_reset_verified_role_mismatch';
  END IF;
  SELECT oid INTO api_role_oid FROM pg_roles
    WHERE rolname = expected_api_user AND NOT rolsuper AND NOT rolbypassrls;
  IF api_role_oid IS NULL THEN
    RAISE EXCEPTION 'password_reset_missing_or_privileged_api_role';
  END IF;

  FOREACH table_name IN ARRAY ARRAY['users', '_prisma_migrations', 'backend_commands'] LOOP
    SELECT c.oid INTO table_oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relkind = 'r';
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'password_reset_missing_prerequisite: %', table_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attname = 'id'
      AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND contype = 'p'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attname = 'id')]::smallint[]) THEN
    RAISE EXCEPTION 'password_reset_invalid_reference_id';
  END IF;
  SELECT pg_get_userbyid(relowner) INTO STRICT private_owner
    FROM pg_class WHERE oid = 'public.backend_commands'::regclass;
  IF private_owner <> expected_owner THEN
    RAISE EXCEPTION 'password_reset_private_owner_mismatch: %', private_owner;
  END IF;
  IF pg_has_role(api_role_oid, (SELECT relowner FROM pg_class WHERE oid = 'public.backend_commands'::regclass), 'USAGE') THEN
    RAISE EXCEPTION 'password_reset_api_role_inherits_table_owner';
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
    RAISE EXCEPTION 'password_reset_invalid_migration_history_schema';
  END IF;

  LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO migration_count FROM public._prisma_migrations WHERE migration_name = target_migration;
  IF migration_count > 1 THEN
    RAISE EXCEPTION 'password_reset_ambiguous_migration_history';
  END IF;
  IF migration_count = 1 THEN
    SELECT checksum, finished_at, rolled_back_at, applied_steps_count
      INTO existing_checksum, existing_finished_at, existing_rolled_back_at, existing_applied_steps
      FROM public._prisma_migrations WHERE migration_name = target_migration;
    IF existing_checksum IS DISTINCT FROM target_checksum THEN
      RAISE EXCEPTION 'password_reset_applied_checksum_mismatch';
    END IF;
    IF existing_finished_at IS NULL OR existing_rolled_back_at IS NOT NULL OR existing_applied_steps IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'password_reset_incomplete_migration_history';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.users'::regclass
      AND attname = 'credential_version' AND NOT attisdropped) THEN
      RAISE EXCEPTION 'password_reset_preexisting_credential_version_without_history';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(target_tables))
      OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = ANY(target_tables)) THEN
      RAISE EXCEPTION 'password_reset_preexisting_objects_without_history';
    END IF;
    EXECUTE migration_sql;
    FOREACH table_name IN ARRAY target_tables LOOP
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', table_name, expected_owner);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, expected_api_user);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO %I', table_name, expected_api_user);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
        api_policy, table_name, expected_api_user);
    END LOOP;
  END IF;

  FOREACH table_name IN ARRAY target_tables LOOP
    SELECT c.oid INTO table_oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relkind = 'r'
        AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner) = expected_owner;
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'password_reset_private_table_state_mismatch: %', table_name;
    END IF;
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = table_oid) <> 1
      OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = table_oid AND polname = api_policy
        AND polcmd = '*' AND polpermissive AND polroles = ARRAY[api_role_oid]
        AND pg_get_expr(polqual, polrelid) = 'true' AND pg_get_expr(polwithcheck, polrelid) = 'true') THEN
      RAISE EXCEPTION 'password_reset_api_policy_mismatch: %', table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
        WHERE c.oid = table_oid AND acl.grantee = 0)
      OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
        AND has_table_privilege(r.oid, table_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
      RAISE EXCEPTION 'password_reset_browser_access_or_policy_exists: %', table_name;
    END IF;
    IF NOT has_table_privilege(api_role_oid, table_oid, 'SELECT')
      OR NOT has_table_privilege(api_role_oid, table_oid, 'INSERT')
      OR NOT has_table_privilege(api_role_oid, table_oid, 'UPDATE')
      OR has_table_privilege(api_role_oid, table_oid, 'DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'password_reset_api_privilege_mismatch: %', table_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.users'::regclass AND a.attname = 'credential_version'
        AND a.atttypid = 'integer'::regtype AND a.attnotnull AND NOT a.attisdropped AND pg_get_expr(d.adbin, d.adrelid) = '0')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND contype = 'c'
      AND convalidated AND pg_get_expr(conbin, conrelid) = '(credential_version >= 0)') THEN
    RAISE EXCEPTION 'password_reset_credential_version_state_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('password_reset_requests', 'id', 'text', true), ('password_reset_requests', 'email', 'text', true),
      ('password_reset_requests', 'user_id', 'text', false), ('password_reset_requests', 'credential_version', 'integer', false),
      ('password_reset_requests', 'token_hash', 'text', true), ('password_reset_requests', 'code_hash', 'text', true),
      ('password_reset_requests', 'attempts', 'integer', true), ('password_reset_requests', 'delivery_status', 'text', true),
      ('password_reset_requests', 'expires_at', 'timestamp with time zone', true), ('password_reset_requests', 'consumed_at', 'timestamp with time zone', false),
      ('password_reset_requests', 'invalidated_at', 'timestamp with time zone', false), ('password_reset_requests', 'completed_version', 'integer', false),
      ('password_reset_requests', 'created_at', 'timestamp with time zone', true),
      ('password_reset_limits', 'key_hash', 'text', true), ('password_reset_limits', 'window_started_at', 'timestamp with time zone', true),
      ('password_reset_limits', 'last_request_at', 'timestamp with time zone', true), ('password_reset_limits', 'request_count', 'integer', true)
    ) AS required(table_name, column_name, type_name, not_null)
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = required.table_name AND a.attname = required.column_name
        AND format_type(a.atttypid, NULL) = required.type_name AND a.attnotnull = required.not_null AND NOT a.attisdropped)
  ) THEN
    RAISE EXCEPTION 'password_reset_private_column_state_mismatch';
  END IF;

  IF migration_count = 0 THEN
    INSERT INTO public._prisma_migrations
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
    VALUES (gen_random_uuid()::text, target_checksum, clock_timestamp(), target_migration, NULL, NULL, started_at, 1);
    RAISE NOTICE 'password_reset_migration_applied: %', target_migration;
  ELSE
    RAISE NOTICE 'password_reset_migration_already_applied: %', target_migration;
  END IF;
END
$apply_password_reset$;
COMMIT;
