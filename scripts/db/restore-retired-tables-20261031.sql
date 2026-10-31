-- Run as the migration owner when rolling back the archival; application grants stay unchanged.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(20261031, 210000);

DO $restore$
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
BEGIN
  FOR i IN 1..cardinality(names) LOOP
    IF to_regclass(format('public.%I', names[i])) IS NOT NULL THEN
      RAISE EXCEPTION 'retired_restore_target_conflict: public.%', names[i];
    END IF;
    SELECT c.oid INTO table_id FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'archive_20261031' AND c.relname = names[i] AND c.relkind = 'r';
    IF table_id IS NULL THEN
      RAISE EXCEPTION 'retired_restore_source_missing: %', names[i];
    END IF;
    EXECUTE format('LOCK TABLE archive_20261031.%I IN ACCESS EXCLUSIVE MODE', names[i]);
    table_ids := array_append(table_ids, table_id);
    EXECUTE format('SELECT count(*) FROM archive_20261031.%I', names[i]) INTO row_count;
    row_counts := array_append(row_counts, row_count);
  END LOOP;

  FOR i IN 1..cardinality(names) LOOP
    EXECUTE format('ALTER TABLE archive_20261031.%I SET SCHEMA public', names[i]);
    IF to_regclass(format('public.%I', names[i]))::oid IS DISTINCT FROM table_ids[i] THEN
      RAISE EXCEPTION 'retired_restore_verification_failed: table identity';
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', names[i]) INTO row_count;
    IF row_count <> row_counts[i] THEN
      RAISE EXCEPTION 'retired_restore_verification_failed: row count';
    END IF;
  END LOOP;
END
$restore$;
COMMIT;
