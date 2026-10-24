BEGIN;

-- Historical counts remain unlinked; an association is recorded only at the time of a new count.
ALTER TABLE inventory_count_records ADD COLUMN cleaning_id TEXT;
CREATE INDEX inventory_count_records_cleaning_id_checked_at_idx ON inventory_count_records(cleaning_id, checked_at);

CREATE TABLE cleaning_visit_photos (
  id TEXT PRIMARY KEY,
  cleaning_id TEXT NOT NULL REFERENCES cleanings(id) ON DELETE CASCADE ON UPDATE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('before', 'after')),
  storage_path TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  uploaded_by_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX cleaning_visit_photos_cleaning_id_phase_uploaded_at_idx ON cleaning_visit_photos(cleaning_id, phase, uploaded_at);
ALTER TABLE cleaning_visit_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cleaning_visit_photos FROM PUBLIC;
DO $permissions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON cleaning_visit_photos FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON cleaning_visit_photos FROM authenticated; END IF;
END;
$permissions$;

COMMIT;
