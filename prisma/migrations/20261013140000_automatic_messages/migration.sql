BEGIN;

CREATE TABLE automatic_message_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  trigger TEXT NOT NULL CHECK (trigger IN ('booking','checkin','checkout')),
  offset_days INTEGER NOT NULL DEFAULT 0 CHECK (offset_days BETWEEN -30 AND 30),
  send_time TEXT NOT NULL DEFAULT '12:00' CHECK (send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  delay_minutes INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes BETWEEN 0 AND 1440),
  default_language TEXT NOT NULL DEFAULT 'en' CHECK (default_language IN ('en','ko','ja','zh')),
  templates JSONB NOT NULL CHECK (jsonb_typeof(templates)='object'),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from TIMESTAMPTZ,
  cutover_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (NOT enabled OR (cutover_confirmed AND effective_from IS NOT NULL)),
  CHECK (trigger <> 'booking' OR offset_days=0),
  UNIQUE (id,organization_id,property_id)
);
CREATE INDEX automatic_message_rules_property ON automatic_message_rules(property_id,created_at,id);
CREATE INDEX automatic_message_rules_active ON automatic_message_rules(id) WHERE enabled;

CREATE TABLE automatic_message_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL,
  organization_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  beds24_booking_id TEXT NOT NULL CHECK (beds24_booking_id ~ '^[1-9][0-9]*$'),
  event_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL CHECK (rule_version > 0),
  rule_name TEXT NOT NULL,
  rule_trigger TEXT NOT NULL CHECK (rule_trigger IN ('booking','checkin','checkout')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sending','accepted','failed','unknown','cancelled','skipped')),
  due_at TIMESTAMPTZ NOT NULL,
  expected_checkin TEXT NOT NULL,
  expected_checkout TEXT NOT NULL,
  booking_time TIMESTAMPTZ,
  channel TEXT NOT NULL,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  send_started_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id TEXT,
  last_error_code TEXT,
  accepted_at TIMESTAMPTZ,
  body_hash TEXT CHECK (body_hash IS NULL OR body_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (rule_id,beds24_booking_id),
  FOREIGN KEY (rule_id,organization_id,property_id) REFERENCES automatic_message_rules(id,organization_id,property_id) ON DELETE RESTRICT
);
CREATE INDEX automatic_message_jobs_due ON automatic_message_jobs(status,due_at,id);
CREATE INDEX automatic_message_jobs_lease ON automatic_message_jobs(status,lease_until);
CREATE INDEX automatic_message_jobs_property_history ON automatic_message_jobs(property_id,created_at DESC,id DESC);
CREATE INDEX automatic_message_jobs_organization_history ON automatic_message_jobs(organization_id,created_at DESC,id DESC);

ALTER TABLE automatic_message_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automatic_message_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON automatic_message_rules,automatic_message_jobs FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE automatic_message_rules,automatic_message_jobs FROM %I',r);
    END IF;
  END LOOP;
END $$;

COMMIT;
