CREATE TABLE IF NOT EXISTS mobile_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (token_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS mobile_sessions_user_expiry_idx ON mobile_sessions(user_id, expires_at);
ALTER TABLE mobile_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mobile_sessions FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS mobile_commands (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','finished')),
  result_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, request_key)
);
ALTER TABLE mobile_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mobile_commands FROM PUBLIC, anon, authenticated;
