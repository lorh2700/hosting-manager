BEGIN;

CREATE TABLE reservation_revenue_sources (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  check_in TEXT NOT NULL CHECK (check_in ~ '^\d{4}-\d{2}-\d{2}$'),
  check_out TEXT NOT NULL CHECK (check_out ~ '^\d{4}-\d{2}-\d{2}$' AND check_out > check_in),
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled','pending','noshow')),
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  total_minor BIGINT CHECK (total_minor BETWEEN 0 AND 1000000000000),
  source TEXT NOT NULL CHECK (source IN ('beds24','checkout')),
  source_channel TEXT NOT NULL DEFAULT 'unknown',
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  source_modified_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,property_id,canonical_key),
  UNIQUE (property_id,canonical_key)
);
CREATE INDEX reservation_revenue_sources_period ON reservation_revenue_sources(organization_id,check_out,check_in,property_id);

CREATE TABLE operating_report_reservation_revenues (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  property_name TEXT NOT NULL,
  check_in TEXT NOT NULL CHECK (check_in ~ '^\d{4}-\d{2}-\d{2}$'),
  check_out TEXT NOT NULL CHECK (check_out ~ '^\d{4}-\d{2}-\d{2}$' AND check_out > check_in),
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled','pending','noshow')),
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  total_minor BIGINT CHECK (total_minor BETWEEN 0 AND 1000000000000),
  source TEXT NOT NULL CHECK (source IN ('beds24','checkout')),
  source_channel TEXT NOT NULL DEFAULT 'unknown',
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  source_observed_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  imported_by TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,property_id,canonical_key),
  UNIQUE (property_id,canonical_key)
);
CREATE INDEX operating_report_reservation_revenues_period ON operating_report_reservation_revenues(organization_id,check_out,check_in,property_id);

CREATE FUNCTION preserve_reservation_revenue_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.property_id IS DISTINCT FROM OLD.property_id OR
     NEW.canonical_key IS DISTINCT FROM OLD.canonical_key THEN
    RAISE EXCEPTION 'reservation revenue ownership is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_reservation_revenue_source_identity BEFORE UPDATE ON reservation_revenue_sources
  FOR EACH ROW EXECUTE FUNCTION preserve_reservation_revenue_identity();
CREATE TRIGGER preserve_imported_reservation_revenue_identity BEFORE UPDATE ON operating_report_reservation_revenues
  FOR EACH ROW EXECUTE FUNCTION preserve_reservation_revenue_identity();

ALTER TABLE reservation_revenue_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_reservation_revenues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reservation_revenue_sources,operating_report_reservation_revenues FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE reservation_revenue_sources,operating_report_reservation_revenues FROM %I',r);
    END IF;
  END LOOP;
END $$;

COMMIT;
