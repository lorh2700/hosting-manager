BEGIN;

CREATE TABLE guest_link_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  purpose TEXT NOT NULL CHECK (purpose IN ('invitation','checkout')),
  property_id TEXT NOT NULL CHECK (property_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  reservation_kind TEXT,
  reservation_id TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((purpose='invitation' AND reservation_kind IS NOT NULL AND reservation_kind IN ('event','booking')
    AND reservation_id IS NOT NULL AND reservation_id ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
    AND expires_at IS NOT NULL) OR
    (purpose='checkout' AND reservation_kind IS NULL AND reservation_id IS NULL AND expires_at IS NULL))
);
CREATE INDEX guest_link_tokens_reservation ON guest_link_tokens(property_id,reservation_kind,reservation_id);

CREATE FUNCTION preserve_guest_link_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.purpose IS DISTINCT FROM OLD.purpose OR
     NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.reservation_kind IS DISTINCT FROM OLD.reservation_kind OR
     NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'guest link identity and revocation are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guest_link_tokens_identity BEFORE UPDATE ON guest_link_tokens FOR EACH ROW EXECUTE FUNCTION preserve_guest_link_identity();

INSERT INTO guest_link_tokens(token_hash,purpose,property_id,reservation_kind,reservation_id,expires_at) VALUES
('db74a611ba40c6925c46cf031109e0fdd89bd86762b615b838f24926c066087d','invitation','c830c242-d1d5-4af1-9f68-43e2f5ae486a','event','a7fe2b31-dec8-4b50-b260-d310fa9f78af',to_timestamp(1795618800)),
('4d87a56434acf93ca5aa66dc6dc9f8071cf987e9de3a2c07cffb708af9454cad','invitation','oKWKVQqLy7uENyHUwljr','event','cb9ac339-4c8d-410e-a828-416a3d260c25',to_timestamp(1794754800)),
('ef1507a1f0350c6915a593480b15cff686d7f99138b57301010b55799c5c4c8a','invitation','c830c242-d1d5-4af1-9f68-43e2f5ae486a','event','0fd99664-5507-4c6e-ab09-5d9ee8eafc42',to_timestamp(1800716400)),
('8bc3e80d7dc7b35138bd381d59467cc150497fff9605f47638405af21027bd8d','checkout','c830c242-d1d5-4af1-9f68-43e2f5ae486a',NULL,NULL,NULL);

ALTER TABLE guest_link_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guest_link_tokens FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE guest_link_tokens FROM %I',r);
    END IF;
  END LOOP;
END $$;

COMMIT;
