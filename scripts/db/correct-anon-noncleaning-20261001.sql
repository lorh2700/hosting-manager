BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $repair$
DECLARE
  target CONSTANT text := '0751098a-4fcf-4d82-8832-cf555efff17a';
  branch CONSTANT text := '70X0HKDJasPU3RQj67aU';
  business text;
  before_row public.cleanings%ROWTYPE;
BEGIN
  SELECT organization_id INTO STRICT business FROM public.properties
    WHERE id = branch AND name = '안온재' FOR UPDATE;
  SELECT * INTO STRICT before_row FROM public.cleanings WHERE id = target FOR UPDATE;
  IF before_row.property_id <> branch OR before_row.date <> '2026-10-01'
    OR before_row.status <> 'done' OR before_row.origin <> 'manual'
    OR before_row.cleaner_id IS NOT NULL OR before_row.assistant_cleaner_id IS NOT NULL
    OR before_row.external_cleaner_name IS NOT NULL OR before_row.completed_at IS NOT NULL
    OR before_row.notes IS NOT NULL OR before_row.completion_note IS NOT NULL THEN
    RAISE EXCEPTION 'cleaning_repair_state_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE property_id = branch AND type = 'reservation'
      AND end_date = '2026-10-01' AND start_date < end_date
      AND NOT ('inquiry' = ANY(tags)) AND (title IS NULL OR title NOT LIKE '[문의]%'))
    OR EXISTS (SELECT 1 FROM public.bookings WHERE property_id = branch AND status = 'confirmed'
      AND check_out = '2026-10-01' AND check_in < check_out)
    OR EXISTS (SELECT 1 FROM public.cleaning_visit_photos WHERE cleaning_id = target)
    OR EXISTS (SELECT 1 FROM public.cleaning_issues WHERE cleaning_id = target)
    OR EXISTS (SELECT 1 FROM public.cleaning_applications WHERE cleaning_id = target) THEN
    RAISE EXCEPTION 'cleaning_repair_has_work_evidence';
  END IF;

  UPDATE public.cleanings SET status = 'cancelled' WHERE id = target;
  INSERT INTO public.audit_logs(id, actor_name, action, module, target_type, target_id,
    property_id, organization_id, summary, outcome, details)
  VALUES ('repair:20261031:anon-noncleaning-20261001', '운영 기록 정정', 'cleaning.record.corrected',
    'cleaning', 'cleaning', target, branch, business,
    '10월 1일 안온재: 실제 청소가 없었다는 운영자 확인에 따라 과거 완료 표시 취소', 'success',
    jsonb_build_object('reason', 'owner_confirmed_no_cleaning', 'beforeStatus', before_row.status,
      'afterStatus', 'cancelled', 'date', before_row.date, 'actualCheckoutCount', 0));
END
$repair$;
COMMIT;
