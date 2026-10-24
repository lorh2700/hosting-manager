CREATE TABLE IF NOT EXISTS mobile_notification_subscriptions (
  session_hash text PRIMARY KEY REFERENCES mobile_sessions(token_hash) ON DELETE CASCADE,
  device_hash text UNIQUE,
  device_ciphertext text,
  snapshot jsonb,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scanned_at timestamptz,
  next_poll_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token text,
  lease_until timestamptz,
  CHECK ((device_hash IS NULL) = (device_ciphertext IS NULL))
);
CREATE INDEX IF NOT EXISTS mobile_notification_poll_idx ON mobile_notification_subscriptions(next_poll_at);
CREATE TABLE IF NOT EXISTS mobile_notifications (
  id text PRIMARY KEY,
  session_hash text NOT NULL REFERENCES mobile_sessions(token_hash) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('inquiry','created','changed','removed','checkin','checkout','cleaning')),
  event_id text NOT NULL,
  date text NOT NULL CHECK (date ~ '^\d{4}-\d{2}-\d{2}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at timestamptz,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','unknown','cancelled'))
);
CREATE INDEX IF NOT EXISTS mobile_notifications_inbox_idx ON mobile_notifications(session_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS mobile_notifications_pending_idx ON mobile_notifications(session_hash) WHERE state='pending';
CREATE INDEX IF NOT EXISTS mobile_messages_received_idx ON messages(property_id,sender,created_at);
ALTER TABLE mobile_notification_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mobile_notification_subscriptions, mobile_notifications FROM PUBLIC, anon, authenticated;

