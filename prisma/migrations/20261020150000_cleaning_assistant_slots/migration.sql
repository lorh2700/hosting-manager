BEGIN;

ALTER TABLE cleanings ADD COLUMN IF NOT EXISTS assistant_cleaner_id TEXT;
ALTER TABLE cleanings ADD COLUMN IF NOT EXISTS assistant_assignment_type TEXT;
ALTER TABLE cleaning_applications ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'primary';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cleanings_assistant_cleaner_id_fkey') THEN
    ALTER TABLE cleanings ADD CONSTRAINT cleanings_assistant_cleaner_id_fkey FOREIGN KEY(assistant_cleaner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cleanings_distinct_assignees') THEN
    ALTER TABLE cleanings ADD CONSTRAINT cleanings_distinct_assignees CHECK (assistant_cleaner_id IS NULL OR cleaner_id IS NULL OR assistant_cleaner_id <> cleaner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cleanings_assistant_assignment_type_check') THEN
    ALTER TABLE cleanings ADD CONSTRAINT cleanings_assistant_assignment_type_check CHECK (assistant_assignment_type IS NULL OR assistant_assignment_type IN ('direct','applied','external'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cleaning_applications_role_check') THEN
    ALTER TABLE cleaning_applications ADD CONSTRAINT cleaning_applications_role_check CHECK (role IN ('primary','assistant'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS cleanings_assistant_cleaner_id_idx ON cleanings(assistant_cleaner_id);
CREATE INDEX IF NOT EXISTS cleaning_applications_role_status_idx ON cleaning_applications(cleaning_id,role,status);

CREATE OR REPLACE FUNCTION guard_cleaning_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE slot_kind TEXT;
BEGIN
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.property_id=NEW.property_id AND OLD.date=NEW.date
      AND (OLD.origin='interim')=(NEW.origin='interim') AND OLD.status<>'cancelled' THEN RETURN NEW; END IF;
  END IF;
  slot_kind := CASE WHEN NEW.origin='interim' THEN 'interim' ELSE 'checkout' END;
  PERFORM id FROM properties WHERE id=NEW.property_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('cleaning-slot:'||NEW.property_id||':'||NEW.date||':'||slot_kind,0));
  IF EXISTS (SELECT 1 FROM cleanings c WHERE c.property_id=NEW.property_id AND c.date=NEW.date
    AND c.status<>'cancelled' AND (c.origin='interim')=(NEW.origin='interim') AND c.id<>NEW.id) THEN
    RAISE EXCEPTION 'cleaning_slot_conflict' USING ERRCODE='23505', CONSTRAINT='cleanings_active_slot_guard';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cleanings_active_slot_guard ON cleanings;
CREATE TRIGGER cleanings_active_slot_guard BEFORE INSERT OR UPDATE OF property_id,date,origin,status ON cleanings
FOR EACH ROW EXECUTE FUNCTION guard_cleaning_slot();

COMMIT;
