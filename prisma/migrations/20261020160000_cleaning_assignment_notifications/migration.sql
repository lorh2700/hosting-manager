BEGIN;

CREATE TABLE IF NOT EXISTS cleaning_assignment_notifications (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audit_logs(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('primary', 'assistant')),
  kind TEXT NOT NULL CHECK (kind IN ('assigned', 'cancelled')),
  recipient_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  attempt_token TEXT,
  last_error_code TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cleaning_assignment_notifications_recipient_key UNIQUE (audit_id, role, kind, recipient_id)
);
CREATE INDEX IF NOT EXISTS cleaning_assignment_notifications_state_idx ON cleaning_assignment_notifications(state, updated_at);
ALTER TABLE cleaning_assignment_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cleaning_assignment_notifications FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON cleaning_assignment_notifications FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON cleaning_assignment_notifications FROM authenticated; END IF;
END $$;

COMMIT;
