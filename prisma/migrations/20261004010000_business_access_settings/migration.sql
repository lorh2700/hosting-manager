-- Additive migration. Roles are retained; promoting any platform operator and
-- assigning business administrators must be deliberate, separately reviewed actions.
BEGIN;
CREATE TABLE organizations (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 features JSONB NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), created_by TEXT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX organizations_status_name_idx ON organizations(status,name);
ALTER TABLE users ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE users ADD COLUMN enabled_modules JSONB;
ALTER TABLE users ADD COLUMN access_version INTEGER NOT NULL DEFAULT 1 CHECK(access_version > 0);
ALTER TABLE invitations ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE properties ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE properties ADD COLUMN feature_overrides JSONB NOT NULL DEFAULT '{}';
ALTER TABLE properties ADD COLUMN feature_version INTEGER NOT NULL DEFAULT 1 CHECK(feature_version > 0);
ALTER TABLE properties ADD COLUMN public_info JSONB NOT NULL DEFAULT '{}';
CREATE INDEX users_organization_id_idx ON users(organization_id);
CREATE INDEX properties_organization_id_idx ON properties(organization_id);

CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY, actor_id TEXT, actor_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, module TEXT,
 target_type TEXT, target_id TEXT, property_id TEXT, organization_id TEXT, summary TEXT NOT NULL,
 outcome TEXT NOT NULL DEFAULT 'success', request_id TEXT, details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_logs_created_at_id_idx ON audit_logs(created_at,id);
CREATE INDEX audit_logs_organization_id_created_at_id_idx ON audit_logs(organization_id,created_at,id);
CREATE INDEX audit_logs_property_id_created_at_idx ON audit_logs(property_id,created_at);
CREATE INDEX audit_logs_actor_id_created_at_idx ON audit_logs(actor_id,created_at);
CREATE INDEX audit_logs_module_outcome_created_at_idx ON audit_logs(module,outcome,created_at);
CREATE FUNCTION retain_operations_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Operation activity records are immutable'; END;
$$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION retain_operations_audit_log();

CREATE TABLE property_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected')),
 requested_by TEXT NOT NULL, decided_by TEXT, decision_note TEXT NOT NULL DEFAULT '', property_id TEXT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at TIMESTAMP(3), version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE INDEX property_requests_organization_id_status_created_at_idx ON property_requests(organization_id,status,created_at);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   REVOKE ALL ON organizations,audit_logs,property_requests FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   REVOKE ALL ON organizations,audit_logs,property_requests FROM authenticated;
 END IF;
END $$;
COMMIT;
