CREATE TABLE organization_pricing_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL DEFAULT 'beds24_direct' CHECK (mode IN ('beds24_direct','pricelabs')),
  target_mode TEXT CHECK (target_mode IN ('beds24_direct','pricelabs')),
  state TEXT NOT NULL DEFAULT 'setup' CHECK (state IN ('setup','ready','switching','paused')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  reason TEXT, evidence JSONB NOT NULL DEFAULT '{}', updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE rate_connections (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('beds24','pricelabs')),
  name TEXT NOT NULL, secret_ref TEXT NOT NULL, credential_generation INTEGER NOT NULL CHECK (credential_generation > 0),
  state TEXT NOT NULL DEFAULT 'setup' CHECK (state IN ('setup','ready','paused')),
  evidence JSONB NOT NULL DEFAULT '{}', verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id,organization_id), UNIQUE(organization_id,provider,secret_ref,credential_generation)
);
CREATE TABLE property_rooms (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, beds24_connection_id TEXT NOT NULL,
  beds24_property_id TEXT NOT NULL CHECK (beds24_property_id ~ '^[1-9][0-9]*$'),
  beds24_room_id TEXT NOT NULL UNIQUE CHECK (beds24_room_id ~ '^[1-9][0-9]*$'),
  daily_price_slot INTEGER NOT NULL CHECK (daily_price_slot BETWEEN 1 AND 16),
  offer_id INTEGER NOT NULL CHECK (offer_id BETWEEN 1 AND 16),
  currency TEXT NOT NULL DEFAULT 'KRW' CHECK (currency='KRW'), base_guests INTEGER NOT NULL DEFAULT 2 CHECK(base_guests BETWEEN 1 AND 10),
  units INTEGER NOT NULL DEFAULT 1 CHECK (units=1), active BOOLEAN NOT NULL DEFAULT TRUE,
  pricelabs_connection_id TEXT, pricelabs_listing_id TEXT, pms TEXT,
  readiness JSONB NOT NULL DEFAULT '{}', verified_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(property_id), UNIQUE(id,organization_id),
  FOREIGN KEY(beds24_connection_id,organization_id) REFERENCES rate_connections(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(pricelabs_connection_id,organization_id) REFERENCES rate_connections(id,organization_id) ON DELETE RESTRICT,
  CHECK((pricelabs_connection_id IS NULL AND pricelabs_listing_id IS NULL AND pms IS NULL) OR (pricelabs_connection_id IS NOT NULL AND pricelabs_listing_id IS NOT NULL AND pms IS NOT NULL))
);
CREATE UNIQUE INDEX property_rooms_pricelabs_listing_unique ON property_rooms(pricelabs_connection_id,pricelabs_listing_id,pms) WHERE pricelabs_connection_id IS NOT NULL;
CREATE INDEX property_rooms_organization ON property_rooms(organization_id,active,property_id);
CREATE TABLE rate_action_grants (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actions JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(actions)='array'), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE rate_calendar_snapshots (
  room_id TEXT NOT NULL REFERENCES property_rooms(id) ON DELETE RESTRICT, date DATE NOT NULL,
  observed JSONB NOT NULL, fingerprint TEXT NOT NULL, checked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(room_id,date)
);
CREATE TABLE rate_change_previews (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  room_id TEXT NOT NULL REFERENCES property_rooms(id) ON DELETE RESTRICT,
  payload JSONB NOT NULL, access_revision TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE calendar_changes (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL DEFAULT '', organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL, room_id TEXT NOT NULL REFERENCES property_rooms(id) ON DELETE RESTRICT,
  key_hash TEXT NOT NULL, request_hash TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('setRate','fixPrice','releasePriceFix','closeSales','releaseSalesBlock')),
  provider TEXT NOT NULL CHECK(provider IN ('beds24','pricelabs')), mode TEXT NOT NULL CHECK(mode IN ('beds24_direct','pricelabs')),
  policy_version INTEGER NOT NULL, room_version INTEGER NOT NULL, mapping JSONB NOT NULL, reason TEXT NOT NULL, block_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','verified','delivery_pending','needs_review','conflict','rejected','cancelled')),
  version INTEGER NOT NULL DEFAULT 1, lease_generation INTEGER NOT NULL DEFAULT 0, lease_until TIMESTAMPTZ,
  sent_at TIMESTAMPTZ, response_complete BOOLEAN NOT NULL DEFAULT FALSE, checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id,key_hash)
);
CREATE INDEX calendar_changes_business_history ON calendar_changes(organization_id,created_at DESC,id DESC);
CREATE INDEX calendar_changes_room_pending ON calendar_changes(room_id,state,created_at);
CREATE TABLE calendar_change_items (
  command_id TEXT NOT NULL REFERENCES calendar_changes(id) ON DELETE RESTRICT,
  room_id TEXT NOT NULL REFERENCES property_rooms(id) ON DELETE RESTRICT, date DATE NOT NULL,
  before_value JSONB NOT NULL, desired_value JSONB NOT NULL, observed_value JSONB,
  state TEXT NOT NULL DEFAULT 'queued', fingerprint TEXT NOT NULL, PRIMARY KEY(command_id,date)
);
CREATE INDEX calendar_change_items_room_date ON calendar_change_items(room_id,date);
CREATE TABLE room_sales_blocks (
  id TEXT NOT NULL, room_id TEXT NOT NULL REFERENCES property_rooms(id) ON DELETE RESTRICT, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  date DATE NOT NULL, previous_override TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE, command_id TEXT NOT NULL REFERENCES calendar_changes(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL, PRIMARY KEY(id,date)
);
CREATE INDEX room_sales_blocks_active ON room_sales_blocks(room_id,date,active);
CREATE TABLE room_reservation_barriers (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES property_rooms(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  from_date DATE NOT NULL, to_exclusive DATE NOT NULL CHECK(to_exclusive>from_date),
  state TEXT NOT NULL CHECK(state IN ('prepared','sent','held','confirmed','released','needs_review')),
  mapping JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX room_reservation_barriers_overlap ON room_reservation_barriers(room_id,state,from_date,to_exclusive);
CREATE TABLE room_price_fixes (
  room_id TEXT NOT NULL REFERENCES property_rooms(id) ON DELETE RESTRICT, date DATE NOT NULL,
  previous_override JSONB, desired_override JSONB NOT NULL, command_id TEXT NOT NULL REFERENCES calendar_changes(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY(room_id,date)
);
CREATE TABLE rate_setup_checks (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL, access_revision TEXT NOT NULL, result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMPTZ
);

CREATE FUNCTION validate_rate_room_business() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM properties p WHERE p.id=NEW.property_id AND p.organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'rate room business mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM rate_connections c WHERE c.id=NEW.beds24_connection_id AND c.organization_id=NEW.organization_id AND c.provider='beds24') OR
    (NEW.pricelabs_connection_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rate_connections c WHERE c.id=NEW.pricelabs_connection_id AND c.organization_id=NEW.organization_id AND c.provider='pricelabs')) THEN
    RAISE EXCEPTION 'rate connection provider mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rate_room_business_check BEFORE INSERT OR UPDATE ON property_rooms FOR EACH ROW EXECUTE FUNCTION validate_rate_room_business();
CREATE FUNCTION invalidate_moved_rate_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.beds24_room_id IS DISTINCT FROM NEW.beds24_room_id OR OLD.beds24_prop_id IS DISTINCT FROM NEW.beds24_prop_id THEN
    UPDATE property_rooms SET active=FALSE,readiness='{}',version=version+1 WHERE property_id=NEW.id;
    UPDATE calendar_changes SET state='cancelled',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE property_id=NEW.id AND state='queued';
    UPDATE room_price_fixes SET active=FALSE WHERE room_id IN(SELECT id FROM property_rooms WHERE property_id=NEW.id);
    DELETE FROM rate_calendar_snapshots WHERE room_id IN(SELECT id FROM property_rooms WHERE property_id=NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invalidate_moved_rate_room AFTER UPDATE OF organization_id,beds24_room_id,beds24_prop_id ON properties FOR EACH ROW EXECUTE FUNCTION invalidate_moved_rate_room();

ALTER TABLE organization_pricing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_action_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_calendar_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_change_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_change_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_sales_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_price_fixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_reservation_barriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_setup_checks ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['organization_pricing_policies','rate_connections','property_rooms','rate_action_grants','rate_calendar_snapshots','rate_change_previews','calendar_changes','calendar_change_items','room_sales_blocks','room_price_fixes','room_reservation_barriers','rate_setup_checks'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r); END IF;
    END LOOP;
  END LOOP;
END $$;
