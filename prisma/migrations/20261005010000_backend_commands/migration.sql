BEGIN;

CREATE TABLE backend_commands (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  access_revision TEXT NOT NULL,
  organization_id TEXT,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded')),
  result_ciphertext TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP(3),
  CONSTRAINT backend_commands_actor_operation_key UNIQUE (actor_id, operation, key_hash),
  CONSTRAINT backend_commands_result_state CHECK (
    (status = 'running' AND result_ciphertext IS NULL AND completed_at IS NULL)
    OR (status = 'succeeded' AND result_ciphertext IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX backend_commands_organization_created_idx ON backend_commands(organization_id, created_at);
ALTER TABLE backend_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backend_commands FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON backend_commands FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON backend_commands FROM authenticated;
  END IF;
END $$;

CREATE FUNCTION retain_completed_backend_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'succeeded' THEN
    RAISE EXCEPTION 'Completed backend commands must be retained';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER backend_commands_retain
  BEFORE UPDATE OR DELETE ON backend_commands
  FOR EACH ROW EXECUTE FUNCTION retain_completed_backend_command();

COMMIT;
