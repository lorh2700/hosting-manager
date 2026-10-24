CREATE TABLE property_pricing_policies (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL DEFAULT 'beds24_direct' CHECK (mode IN ('beds24_direct','pricelabs')),
  target_mode TEXT CHECK (target_mode IN ('beds24_direct','pricelabs')),
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('setup','ready','switching','paused')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  reason TEXT, evidence JSONB NOT NULL DEFAULT '{}', updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX property_pricing_policies_organization ON property_pricing_policies(organization_id,property_id);

INSERT INTO property_pricing_policies(property_id,organization_id,mode,state,version,evidence)
SELECT p.id,p.organization_id,COALESCE(o.mode,'beds24_direct'),
  CASE WHEN o.state='paused' THEN 'paused' ELSE 'ready' END,COALESCE(o.version,1),COALESCE(o.evidence,'{}'::jsonb)
FROM properties p LEFT JOIN organization_pricing_policies o ON o.organization_id=p.organization_id
WHERE p.organization_id IS NOT NULL;

CREATE FUNCTION validate_property_pricing_policy_business() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM properties WHERE id=NEW.property_id AND organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'pricing policy property business mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER property_pricing_policy_business_check BEFORE INSERT OR UPDATE ON property_pricing_policies
FOR EACH ROW EXECUTE FUNCTION validate_property_pricing_policy_business();

CREATE FUNCTION invalidate_moved_property_pricing_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    DELETE FROM property_pricing_policies WHERE property_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invalidate_moved_property_pricing_policy AFTER UPDATE OF organization_id ON properties
FOR EACH ROW EXECUTE FUNCTION invalidate_moved_property_pricing_policy();

ALTER TABLE property_pricing_policies ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE property_pricing_policies FROM %I',r); END IF;
  END LOOP;
END $$;
