CREATE TABLE business_signup_email_limits (
  email TEXT PRIMARY KEY CHECK (email = lower(email)),
  window_started_at TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ NOT NULL,
  sent_count INTEGER NOT NULL CHECK (sent_count >= 0)
);

CREATE TABLE business_email_verifications (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(email)),
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX business_email_verifications_email_idx ON business_email_verifications(email, created_at DESC);

CREATE TABLE business_signup_applications (
  id TEXT PRIMARY KEY,
  verification_id TEXT NOT NULL UNIQUE REFERENCES business_email_verifications(id) ON DELETE RESTRICT,
  email TEXT NOT NULL CHECK (email = lower(email)),
  business_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  password_hash TEXT,
  email_verified_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  decided_at TIMESTAMPTZ,
  decided_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  decision_note TEXT,
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  notification_status TEXT CHECK (notification_status IN ('pending','sent','failed')),
  notification_attempted_at TIMESTAMPTZ,
  notification_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'pending' AND password_hash IS NOT NULL AND decided_at IS NULL AND notification_status IS NULL)
    OR (status <> 'pending' AND password_hash IS NULL AND decided_at IS NOT NULL AND notification_status IS NOT NULL)),
  CHECK ((status = 'approved' AND organization_id IS NOT NULL AND user_id IS NOT NULL)
    OR (status <> 'approved' AND organization_id IS NULL AND user_id IS NULL))
);
CREATE UNIQUE INDEX business_signup_applications_open_email_idx ON business_signup_applications(email) WHERE status IN ('pending','approved');
CREATE INDEX business_signup_applications_queue_idx ON business_signup_applications(status, created_at DESC, id DESC);
CREATE INDEX business_signup_applications_email_idx ON business_signup_applications(email, created_at DESC);

ALTER TABLE business_signup_email_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_signup_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON business_signup_email_limits, business_email_verifications, business_signup_applications FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON business_signup_email_limits, business_email_verifications, business_signup_applications FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON business_signup_email_limits, business_email_verifications, business_signup_applications FROM authenticated;
  END IF;
END $$;
