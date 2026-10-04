CREATE TABLE IF NOT EXISTS guest_stay_accesses (
 id TEXT PRIMARY KEY, property_id TEXT NOT NULL, reservation_kind TEXT NOT NULL CHECK (reservation_kind IN ('event','booking')),
 reservation_id TEXT NOT NULL, fingerprint TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('manual','invitation','device')),
 code_hash TEXT UNIQUE, token_hash TEXT UNIQUE, token_expires_at TIMESTAMP(3), device_id TEXT,
 expires_at TIMESTAMP(3) NOT NULL, revoked_at TIMESTAMP(3), created_by TEXT, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS guest_stay_accesses_reservation_idx ON guest_stay_accesses(property_id,reservation_kind,reservation_id);
CREATE INDEX IF NOT EXISTS guest_stay_accesses_device_idx ON guest_stay_accesses(device_id,revoked_at);
CREATE TABLE IF NOT EXISTS guest_stay_sessions (
 id TEXT PRIMARY KEY, access_id TEXT NOT NULL REFERENCES guest_stay_accesses(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMP(3) NOT NULL, revoked_at TIMESTAMP(3), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS guest_stay_sessions_access_idx ON guest_stay_sessions(access_id,revoked_at);
CREATE TABLE IF NOT EXISTS guest_stay_requests (
 id TEXT PRIMARY KEY, property_id TEXT NOT NULL, reservation_kind TEXT NOT NULL CHECK(reservation_kind IN ('event','booking')),
 reservation_id TEXT NOT NULL, guest_name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tour','taxi','help')), details JSONB NOT NULL,
 source TEXT NOT NULL DEFAULT 'mobile' CHECK(source IN ('mobile','pad')), payload_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','reviewing','confirmed','completed','cancelled')),
 public_reply TEXT NOT NULL DEFAULT '', internal_note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 updated_by TEXT, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS guest_stay_requests_reservation_idx ON guest_stay_requests(property_id,reservation_kind,reservation_id,created_at);
CREATE INDEX IF NOT EXISTS guest_stay_requests_status_idx ON guest_stay_requests(property_id,status,created_at);
CREATE TABLE IF NOT EXISTS guest_stay_attempts (key_hash TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 1, expires_at TIMESTAMP(3) NOT NULL);
CREATE INDEX IF NOT EXISTS guest_stay_attempts_expiry_idx ON guest_stay_attempts(expires_at);
CREATE TABLE IF NOT EXISTS guest_stay_devices (
 id TEXT PRIMARY KEY, property_id TEXT NOT NULL, label TEXT NOT NULL, pairing_hash TEXT UNIQUE, pairing_expires_at TIMESTAMP(3) NOT NULL,
 token_hash TEXT UNIQUE, paired_at TIMESTAMP(3), expires_at TIMESTAMP(3) NOT NULL, revoked_at TIMESTAMP(3), created_by TEXT NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS guest_stay_devices_property_idx ON guest_stay_devices(property_id,revoked_at);
-- Only the application's server database role can access reservation credentials and requests.
ALTER TABLE guest_stay_accesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_stay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_stay_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_stay_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_stay_devices ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   REVOKE ALL ON guest_stay_accesses,guest_stay_sessions,guest_stay_requests,guest_stay_attempts,guest_stay_devices FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   REVOKE ALL ON guest_stay_accesses,guest_stay_sessions,guest_stay_requests,guest_stay_attempts,guest_stay_devices FROM authenticated;
 END IF;
END $$;
