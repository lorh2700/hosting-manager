BEGIN;
SET LOCAL lock_timeout = '3s';
DO $restore$
BEGIN
  UPDATE public.cleanings SET status = 'done'
    WHERE id = '0751098a-4fcf-4d82-8832-cf555efff17a'
      AND property_id = '70X0HKDJasPU3RQj67aU' AND date = '2026-10-01'
      AND status = 'cancelled' AND cleaner_id IS NULL AND assistant_cleaner_id IS NULL
      AND completed_at IS NULL AND EXISTS (
        SELECT 1 FROM public.audit_logs WHERE id = 'repair:20261031:anon-noncleaning-20261001'
          AND target_id = '0751098a-4fcf-4d82-8832-cf555efff17a');
  IF NOT FOUND THEN RAISE EXCEPTION 'cleaning_restore_state_changed'; END IF;
END
$restore$;
COMMIT;
