BEGIN;
CREATE TABLE reservation_sms_deliveries (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  organization_id TEXT,
  reservation_key TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  reservation_version TEXT NOT NULL,
  created_by TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','accepted','failed','unknown')),
  attempt_token TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  sent_at TIMESTAMPTZ(3),
  UNIQUE(property_id,reservation_key,content_hash),
  CHECK (status <> 'accepted' OR (provider_message_id IS NOT NULL AND sent_at IS NOT NULL))
);
CREATE INDEX reservation_sms_deliveries_history_idx ON reservation_sms_deliveries(property_id,reservation_key,created_at DESC);
ALTER TABLE reservation_sms_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reservation_sms_deliveries FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON reservation_sms_deliveries FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON reservation_sms_deliveries FROM authenticated; END IF;
END $$;
CREATE FUNCTION retain_reservation_sms_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status IN ('accepted','failed','unknown') THEN
    RAISE EXCEPTION 'Reservation SMS outcomes must be retained';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.property_id IS DISTINCT FROM OLD.property_id OR
     NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.reservation_key IS DISTINCT FROM OLD.reservation_key OR
     NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR
     NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.payload_ciphertext IS DISTINCT FROM OLD.payload_ciphertext OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Reservation SMS identity and preview must be retained';
  END IF;
  IF OLD.status = 'sending' AND NEW.status NOT IN ('accepted','failed','unknown') THEN
    RAISE EXCEPTION 'Reservation SMS attempts cannot be sent again';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_sms_deliveries_retain BEFORE UPDATE OR DELETE ON reservation_sms_deliveries
  FOR EACH ROW EXECUTE FUNCTION retain_reservation_sms_outcome();
COMMIT;
