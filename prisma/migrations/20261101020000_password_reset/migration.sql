ALTER TABLE users ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0 CHECK (credential_version >= 0);

CREATE TABLE password_reset_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  credential_version INTEGER CHECK (credential_version >= 0),
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'sent', 'failed', 'ignored')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  completed_version INTEGER CHECK (completed_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((consumed_at IS NULL) = (completed_version IS NULL))
);
CREATE INDEX password_reset_requests_email_idx ON password_reset_requests(email, created_at DESC);
CREATE INDEX password_reset_requests_user_idx ON password_reset_requests(user_id);
CREATE INDEX password_reset_requests_expiry_idx ON password_reset_requests(expires_at);

CREATE TABLE password_reset_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  last_request_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);

ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON password_reset_requests, password_reset_limits FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON password_reset_requests, password_reset_limits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON password_reset_requests, password_reset_limits FROM authenticated;
  END IF;
END $$;
