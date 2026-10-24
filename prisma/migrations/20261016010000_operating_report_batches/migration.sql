BEGIN;

CREATE TABLE operating_report_batches (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 period TEXT NOT NULL CHECK (period IN ('day','week','month')),
 period_from TEXT NOT NULL CHECK (period_from ~ '^\d{4}-\d{2}-\d{2}$'),
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','failed')),
 requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 scheduled_day TEXT NOT NULL,
 lease_token TEXT, lease_until TIMESTAMPTZ,
 attempts INTEGER NOT NULL DEFAULT 0,
 retry_at TIMESTAMPTZ, error_code TEXT,
 generated_at TIMESTAMPTZ, body JSONB,
 PRIMARY KEY (organization_id,period,period_from)
);
CREATE INDEX operating_report_batches_pending ON operating_report_batches(status,retry_at,requested_at);
ALTER TABLE operating_report_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON operating_report_batches FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON operating_report_batches FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON operating_report_batches FROM authenticated; END IF;
END $$;
COMMIT;
