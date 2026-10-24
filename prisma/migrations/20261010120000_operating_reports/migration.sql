BEGIN;

CREATE TABLE operating_report_state (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE operating_report_properties (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 property_id TEXT NOT NULL, property_name TEXT NOT NULL,
 PRIMARY KEY (organization_id, property_id)
);
CREATE TABLE operating_report_entries (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 property_id TEXT, property_name TEXT, kind TEXT NOT NULL CHECK (kind IN ('revenue','expense','cash')),
 service_date TEXT NOT NULL CHECK (service_date ~ '^\d{4}-\d{2}-\d{2}$'),
 category TEXT NOT NULL, amount_minor BIGINT CHECK (amount_minor BETWEEN -1000000000000 AND 1000000000000),
 source_key TEXT NOT NULL, canonical_key TEXT, tax_status TEXT NOT NULL CHECK (tax_status IN ('exclusive','not_applicable','unknown')),
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')), version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
 body JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (organization_id, kind, source_key)
);
CREATE INDEX operating_report_entries_period ON operating_report_entries(organization_id,service_date,id);
CREATE INDEX operating_report_entries_property ON operating_report_entries(organization_id,property_id,service_date);
CREATE UNIQUE INDEX operating_report_room_revenue_unique ON operating_report_entries(organization_id,property_id,canonical_key,service_date)
 WHERE kind='revenue' AND category='room' AND status='active';
CREATE TABLE operating_report_capacity (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 property_id TEXT NOT NULL, service_date TEXT NOT NULL, supply INTEGER NOT NULL CHECK (supply >= 0),
 blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked >= 0 AND blocked <= supply),
 PRIMARY KEY (organization_id, property_id, service_date)
);
CREATE TABLE operating_report_nights (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 property_id TEXT NOT NULL, canonical_key TEXT NOT NULL, service_date TEXT NOT NULL,
 room_count INTEGER NOT NULL CHECK (room_count >= 0),
 classification TEXT NOT NULL CHECK (classification IN ('paid','complimentary','owner','noshow','cancelled')),
 PRIMARY KEY (organization_id, property_id, canonical_key, service_date)
);
CREATE INDEX operating_report_nights_period ON operating_report_nights(organization_id,service_date,property_id);
CREATE TABLE operating_report_coverage (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 property_key TEXT NOT NULL, service_date TEXT NOT NULL,
 revenue BOOLEAN NOT NULL DEFAULT FALSE, cost BOOLEAN NOT NULL DEFAULT FALSE,
 occupancy BOOLEAN NOT NULL DEFAULT FALSE, capacity BOOLEAN NOT NULL DEFAULT FALSE, cash BOOLEAN NOT NULL DEFAULT FALSE,
 source_signature TEXT NOT NULL DEFAULT '', confirmed_by TEXT NOT NULL, confirmed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (organization_id,property_key,service_date)
);
CREATE TABLE operating_report_months (
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, month TEXT NOT NULL CHECK(month ~ '^\d{4}-\d{2}$'),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')), version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
 PRIMARY KEY (organization_id,month)
);
CREATE TABLE operating_report_snapshots (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, month TEXT NOT NULL,
 version INTEGER NOT NULL, revision INTEGER NOT NULL, policy_version INTEGER NOT NULL, body JSONB NOT NULL,
 created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (organization_id,month,version)
);
CREATE TABLE operating_report_history (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, reason TEXT NOT NULL, before_value JSONB, after_value JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX operating_report_history_org_time ON operating_report_history(organization_id,created_at,id);
CREATE TABLE operating_report_receipts (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 entry_id TEXT NOT NULL REFERENCES operating_report_entries(id) ON DELETE RESTRICT,
 actor_id TEXT NOT NULL, request_hash TEXT NOT NULL, source_hash TEXT NOT NULL, storage_hash TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=2097152),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,actor_id,request_hash)
);
CREATE INDEX operating_report_receipts_entry ON operating_report_receipts(organization_id,entry_id,created_at);
CREATE VIEW operating_report_reservation_sources AS
 SELECT 'event:' || e.id AS id,e.property_id,
  CASE WHEN e.channel_id='beds24' AND e.original_uid IS NOT NULL THEN 'legacy-beds24:' || e.property_id || ':' || e.original_uid ELSE 'event:' || e.id END AS canonical_key,
  e.start_date AS check_in,e.end_date AS check_out,'confirmed'::text AS status,COALESCE(e.source,e.channel_id,'unknown') AS source,
  md5(COALESCE(e.description,'') || COALESCE(e.tags::text,'')) AS content_signature
 FROM events e WHERE e.type='reservation' AND NOT ('inquiry'=ANY(e.tags)) AND (e.title IS NULL OR e.title NOT LIKE '[문의]%')
  AND NOT EXISTS(SELECT 1 FROM checkout_orders o WHERE o.property_id=e.property_id AND o.beds24_id=e.original_uid AND o.mode<>'live')
 UNION ALL
 SELECT 'booking:' || b.id,b.property_id,
  CASE WHEN COALESCE(b.channel_booking_ref,o.beds24_id) IS NOT NULL THEN 'legacy-beds24:' || b.property_id || ':' || COALESCE(b.channel_booking_ref,o.beds24_id) ELSE 'booking:' || b.id END,
  b.check_in,b.check_out,b.status,b.source,md5(COALESCE(o.amount_minor::text,'') || COALESCE(o.status,''))
 FROM bookings b LEFT JOIN checkout_orders o ON o.booking_id=b.id
 WHERE (o.id IS NULL OR o.mode='live')
  AND NOT EXISTS(SELECT 1 FROM events e WHERE e.property_id=b.property_id AND e.channel_id='beds24' AND e.original_uid=COALESCE(b.channel_booking_ref,o.beds24_id)
   AND e.type='reservation' AND NOT ('inquiry'=ANY(e.tags)) AND (e.title IS NULL OR e.title NOT LIKE '[문의]%'));
CREATE FUNCTION preserve_operating_report_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operating report history and published snapshots are immutable'; END;
$$;
CREATE TRIGGER operating_report_history_immutable BEFORE UPDATE OR DELETE ON operating_report_history FOR EACH ROW EXECUTE FUNCTION preserve_operating_report_history();
CREATE TRIGGER operating_report_snapshots_immutable BEFORE UPDATE OR DELETE ON operating_report_snapshots FOR EACH ROW EXECUTE FUNCTION preserve_operating_report_history();

ALTER TABLE operating_report_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_nights ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_report_receipts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON operating_report_state,operating_report_properties,operating_report_entries,operating_report_capacity,operating_report_nights,operating_report_coverage,operating_report_months,operating_report_snapshots,operating_report_history,operating_report_reservation_sources,operating_report_receipts FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON operating_report_state,operating_report_properties,operating_report_entries,operating_report_capacity,operating_report_nights,operating_report_coverage,operating_report_months,operating_report_snapshots,operating_report_history,operating_report_reservation_sources,operating_report_receipts FROM authenticated;
 END IF;
END $$;
COMMIT;
