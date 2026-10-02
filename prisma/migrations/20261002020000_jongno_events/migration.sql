BEGIN;

CREATE TABLE jongno_events (
  id TEXT PRIMARY KEY,
  title_ko TEXT NOT NULL CHECK (char_length(title_ko) BETWEEN 1 AND 200),
  title_en TEXT NOT NULL DEFAULT '',
  description_ko TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('festival','exhibition','performance','palace','experience')),
  area TEXT NOT NULL CHECK (area IN ('bukchon','insadong','seochon','daehakro','other')),
  venue TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL CHECK (start_date ~ '^\d{4}-\d{2}-\d{2}$' AND start_date::date::text = start_date),
  end_date TEXT NOT NULL CHECK (end_date ~ '^\d{4}-\d{2}-\d{2}$' AND end_date::date::text = end_date AND end_date >= start_date),
  time_text TEXT NOT NULL DEFAULT '',
  excluded_weekdays JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(excluded_weekdays) = 'array' AND jsonb_array_length(excluded_weekdays) <= 7),
  excluded_dates JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(excluded_dates) = 'array' AND jsonb_array_length(excluded_dates) <= 100),
  fee_type TEXT NOT NULL DEFAULT 'unknown' CHECK (fee_type IN ('free','paid','unknown')),
  fee_text TEXT NOT NULL DEFAULT '',
  booking_required BOOLEAN NOT NULL DEFAULT false,
  official_url TEXT NOT NULL DEFAULT '',
  booking_url TEXT NOT NULL DEFAULT '',
  map_url TEXT NOT NULL DEFAULT '',
  language_text TEXT NOT NULL DEFAULT '',
  images JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(images) = 'array' AND jsonb_array_length(images) <= 6),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  verified_at TIMESTAMP(3),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'published' OR (official_url ~ '^https?://' AND verified_at IS NOT NULL))
);
CREATE INDEX jongno_events_status_start_date_end_date_idx ON jongno_events(status, start_date, end_date);
CREATE INDEX jongno_events_status_area_start_date_idx ON jongno_events(status, area, start_date);

-- Only the authenticated server API exposes this content. Client database keys
-- cannot read unpublished drafts or change shared public editorial information.
ALTER TABLE jongno_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jongno_events FROM PUBLIC;
DO $permissions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON jongno_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON jongno_events FROM authenticated;
  END IF;
END;
$permissions$;

COMMIT;
