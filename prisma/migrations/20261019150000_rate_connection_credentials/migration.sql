ALTER TABLE rate_connections ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE TABLE rate_connection_credentials (
  connection_id TEXT PRIMARY KEY REFERENCES rate_connections(id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK (generation > 0),
  ciphertext TEXT NOT NULL CHECK (length(ciphertext) BETWEEN 40 AND 12000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE rate_connection_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_connection_credentials FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON rate_connection_credentials FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON rate_connection_credentials FROM authenticated;
  END IF;
END $$;
