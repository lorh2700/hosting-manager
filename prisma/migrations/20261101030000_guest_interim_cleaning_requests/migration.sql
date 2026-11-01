ALTER TABLE guest_stay_requests DROP CONSTRAINT IF EXISTS guest_stay_requests_kind_check;
ALTER TABLE guest_stay_requests ADD CONSTRAINT guest_stay_requests_kind_check
  CHECK (kind IN ('tour','taxi','help','interim_cleaning'));

ALTER TABLE guest_stay_requests ADD COLUMN cleaning_id TEXT
  REFERENCES cleanings(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX guest_stay_requests_cleaning_id_key ON guest_stay_requests(cleaning_id);
CREATE UNIQUE INDEX guest_stay_requests_interim_active_date_key
  ON guest_stay_requests(property_id,reservation_kind,reservation_id,(details->>'date'))
  WHERE kind='interim_cleaning' AND status<>'cancelled';

ALTER TABLE guest_stay_requests ADD CONSTRAINT guest_stay_requests_interim_details_check CHECK (
  kind<>'interim_cleaning' OR (
    jsonb_typeof(details)='object' AND details ? 'date' AND details ? 'time' AND details ? 'note'
    AND jsonb_typeof(details->'date')='string' AND (details->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND jsonb_typeof(details->'time')='string' AND (details->>'time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND jsonb_typeof(details->'note')='string' AND length(details->>'note')<=1000
  )
);

-- Existing request RLS and server-only grants remain unchanged.

ALTER TABLE cleaning_assignment_notifications DROP CONSTRAINT IF EXISTS cleaning_assignment_notifications_kind_check;
ALTER TABLE cleaning_assignment_notifications ADD CONSTRAINT cleaning_assignment_notifications_kind_check
  CHECK (kind IN ('assigned','cancelled','recruitment'));
