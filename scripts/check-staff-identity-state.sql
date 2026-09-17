-- Read-only diagnostic. Does not expose account data or change migration state.
-- If this session reports an aborted transaction, run ROLLBACK first.
SELECT
  to_regclass('public.cleaners') IS NOT NULL AS old_cleaners_exists,
  to_regclass('public.cleaner_properties') IS NOT NULL AS old_scope_exists,
  to_regclass('public.legacy_cleaners') IS NOT NULL AS legacy_cleaners_exists,
  to_regclass('public.legacy_cleaner_properties') IS NOT NULL AS legacy_scope_exists,
  to_regclass('public.staff_identity_users_before') IS NOT NULL AS snapshot_exists,
  to_regclass('public.staff_identity_map') IS NOT NULL AS identity_map_exists,
  ARRAY(SELECT column_name::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users'
      AND column_name IN ('owner_id','public_token','notify_new_open')
    ORDER BY column_name) AS added_user_columns,
  (SELECT c.confrelid::regclass::text FROM pg_constraint c
    WHERE c.conrelid=to_regclass('public.cleanings')
      AND c.conname='cleanings_cleaner_id_fkey') AS cleaning_assignee_table;
