BEGIN;
CREATE TABLE backend_reservation_commands (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('create','cancel')),
  key_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','sent','needs_review','confirmed','cancelled','rejected')),
  external_id TEXT,
  reservation_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id,operation,key_hash)
);
CREATE INDEX backend_reservation_commands_property_state_idx ON backend_reservation_commands(property_id,state,created_at);
CREATE TABLE backend_guest_notes (
  organization_id TEXT NOT NULL,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,guest_id)
);
CREATE TABLE backend_reservation_annotations (
  reservation_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE backend_reservation_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE backend_guest_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE backend_reservation_annotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backend_reservation_commands,backend_guest_notes,backend_reservation_annotations FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON backend_reservation_commands,backend_guest_notes,backend_reservation_annotations FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON backend_reservation_commands,backend_guest_notes,backend_reservation_annotations FROM authenticated; END IF;
END $$;
COMMIT;
