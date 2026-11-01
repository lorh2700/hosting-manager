ALTER TABLE cleanings ADD COLUMN reservation_id TEXT;
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
