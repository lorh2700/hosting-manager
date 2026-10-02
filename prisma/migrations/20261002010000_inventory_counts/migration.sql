BEGIN;

CREATE TABLE inventory_snapshots (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  items JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 100),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_count_records (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  request_hash TEXT NOT NULL,
  base_version INTEGER NOT NULL CHECK (base_version >= 0),
  version INTEGER NOT NULL CHECK (version = base_version + 1),
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 30),
  result_items JSONB NOT NULL CHECK (jsonb_typeof(result_items) = 'array' AND jsonb_array_length(result_items) <= 100),
  checked_by_id TEXT NOT NULL,
  checked_by TEXT NOT NULL,
  checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX inventory_count_records_property_id_version_key ON inventory_count_records(property_id, version);
CREATE INDEX inventory_count_records_property_id_checked_at_idx ON inventory_count_records(property_id, checked_at);

CREATE FUNCTION prevent_inventory_count_changes() RETURNS trigger LANGUAGE plpgsql AS $immutable$
BEGIN
  RAISE EXCEPTION 'Inventory count records are immutable';
END;
$immutable$;
CREATE TRIGGER inventory_count_records_immutable BEFORE UPDATE OR DELETE ON inventory_count_records
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_count_changes();

ALTER TABLE inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_snapshots, inventory_count_records FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_inventory_count_changes() FROM PUBLIC;
DO $permissions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON inventory_snapshots, inventory_count_records FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON inventory_snapshots, inventory_count_records FROM authenticated;
  END IF;
END;
$permissions$;

COMMIT;
