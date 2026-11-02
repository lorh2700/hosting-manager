ALTER TABLE mobile_notifications
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id text,
  ADD COLUMN IF NOT EXISTS organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_key text,
  ALTER COLUMN property_id DROP NOT NULL;

ALTER TABLE mobile_notifications DROP CONSTRAINT IF EXISTS mobile_notifications_kind_check;
ALTER TABLE mobile_notifications ADD CONSTRAINT mobile_notifications_kind_check
  CHECK (kind IN ('inquiry','created','changed','removed','checkin','checkout','cleaning','operation'));

ALTER TABLE mobile_notifications ADD CONSTRAINT mobile_notifications_operation_resource_check
  CHECK (
    (kind <> 'operation' AND property_id IS NOT NULL)
    OR
    (kind = 'operation'
      AND resource_type IS NOT NULL
      AND resource_type IN ('guest_request','tour_booking','checkout_signal','inquiry_notification','cleaning_assignment')
      AND resource_id IS NOT NULL AND length(resource_id) > 0
      AND source_key IS NOT NULL AND length(source_key) > 0)
  );

CREATE INDEX mobile_notifications_operation_resource_idx
  ON mobile_notifications(resource_type, resource_id) WHERE kind = 'operation';
