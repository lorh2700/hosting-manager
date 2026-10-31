-- Read-only diagnostic. Does not expose account data or change migration state.
-- If this session reports an aborted transaction, run ROLLBACK first.
SELECT
  to_regclass('public.cleaners') IS NOT NULL AS old_cleaners_exists,
  to_regclass('public.cleaner_properties') IS NOT NULL AS old_scope_exists,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='legacy_cleaners' AND n.nspname IN ('public','archive_20261031')
      AND c.relkind='r') AS legacy_cleaners_exists,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='legacy_cleaner_properties' AND n.nspname IN ('public','archive_20261031')
      AND c.relkind='r') AS legacy_scope_exists,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='staff_identity_users_before' AND n.nspname IN ('public','archive_20261031')
      AND c.relkind='r') AS snapshot_exists,
  ARRAY(SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='archive_20261031' AND c.relkind='r'
      AND c.relname IN ('legacy_cleaners','legacy_cleaner_properties','staff_identity_users_before')
    ORDER BY c.relname) AS archived_staff_tables,
  to_regclass('public.staff_identity_map') IS NOT NULL AS identity_map_exists,
  ARRAY(SELECT column_name::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users'
      AND column_name IN ('owner_id','public_token','notify_new_open')
    ORDER BY column_name) AS added_user_columns,
  (SELECT c.confrelid::regclass::text FROM pg_constraint c
    WHERE c.conrelid=to_regclass('public.cleanings')
      AND c.conname='cleanings_cleaner_id_fkey') AS cleaning_assignee_table;
