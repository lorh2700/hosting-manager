-- Run this whole statement before deploying the guest pickup request feature.
DO $guest_services$ BEGIN
CREATE TABLE guest_service_requests (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  kind TEXT NOT NULL DEFAULT 'airport_pickup',
  guest_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  arrival_date TEXT NOT NULL,
  arrival_time TEXT NOT NULL,
  flight_number TEXT NOT NULL,
  passengers INTEGER NOT NULL CHECK (passengers BETWEEN 1 AND 12),
  luggage INTEGER NOT NULL CHECK (luggage BETWEEN 0 AND 30),
  message TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','contacted','confirmed','cancelled')),
  quoted_price INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  consent_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  internal_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX guest_service_requests_property_id_status_created_at_idx ON guest_service_requests(property_id,status,created_at);
ALTER TABLE guest_service_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guest_service_requests FROM PUBLIC;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON guest_service_requests FROM anon; END IF;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON guest_service_requests FROM authenticated; END IF;
END $guest_services$;
