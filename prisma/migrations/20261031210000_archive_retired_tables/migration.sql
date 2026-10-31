BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(20261031, 210000);

DO $archive$
DECLARE
  names CONSTANT text[] := ARRAY[
    'legacy_cleaners', 'legacy_cleaner_properties', 'staff_identity_users_before',
    'organization_pricing_policies', 'rate_setup_checks'
  ];
  table_ids oid[] := ARRAY[]::oid[];
  row_counts bigint[] := ARRAY[]::bigint[];
  table_id oid;
  row_count bigint;
  i integer;
  name_pattern text := '\m(' || array_to_string(names, '|') || ')\M';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'archive_20261031') THEN
    RAISE EXCEPTION 'retired_archive_target_conflict: archive_20261031 already exists';
  END IF;

  FOR i IN 1..cardinality(names) LOOP
    SELECT c.oid INTO table_id FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = names[i] AND c.relkind = 'r'
        AND NOT c.relispartition AND c.relpersistence = 'p';
    IF table_id IS NULL THEN
      RAISE EXCEPTION 'retired_archive_source_missing: public.%', names[i];
    END IF;
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', names[i]);
    table_ids := array_append(table_ids, table_id);
    EXECUTE format('SELECT count(*) FROM public.%I', names[i]) INTO row_count;
    row_counts := array_append(row_counts, row_count);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f'
      AND confrelid = ANY(table_ids) AND NOT conrelid = ANY(table_ids)) THEN
    RAISE EXCEPTION 'retired_archive_dependency: incoming foreign key';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
      WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
        AND d.refobjid = ANY(table_ids) AND NOT r.ev_class = ANY(table_ids)) THEN
    RAISE EXCEPTION 'retired_archive_dependency: view or rule';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
      WHERE d.classid = 'pg_proc'::regclass AND (
        (d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY(table_ids)) OR
        (d.refclassid = 'pg_type'::regclass AND d.refobjid IN
          (SELECT reltype FROM pg_class WHERE oid = ANY(table_ids)))))
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ~* name_pattern) THEN
    -- PL/pgSQL and string-bodied SQL functions need a text check as well as pg_depend.
    RAISE EXCEPTION 'retired_archive_dependency: function or procedure';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ANY(table_ids) AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'retired_archive_dependency: user trigger';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_policy p ON p.oid = d.objid
      WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_class'::regclass
        AND d.refobjid = ANY(table_ids) AND NOT p.polrelid = ANY(table_ids)) THEN
    RAISE EXCEPTION 'retired_archive_dependency: external row security policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = ANY(table_ids) OR inhparent = ANY(table_ids))
    OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = ANY(names)) THEN
    RAISE EXCEPTION 'retired_archive_dependency: inheritance or publication';
  END IF;

  CREATE SCHEMA archive_20261031;
  REVOKE ALL ON SCHEMA archive_20261031 FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname = 'archive_20261031' AND a.grantee <> n.nspowner) THEN
    RAISE EXCEPTION 'retired_archive_access_conflict: schema default privileges';
  END IF;

  FOR i IN 1..cardinality(names) LOOP
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA archive_20261031', names[i]);
    IF to_regclass(format('archive_20261031.%I', names[i]))::oid IS DISTINCT FROM table_ids[i] THEN
      RAISE EXCEPTION 'retired_archive_verification_failed: table identity';
    END IF;
    EXECUTE format('SELECT count(*) FROM archive_20261031.%I', names[i]) INTO row_count;
    IF row_count <> row_counts[i] THEN
      RAISE EXCEPTION 'retired_archive_verification_failed: row count';
    END IF;
  END LOOP;
END
$archive$;
COMMIT;
