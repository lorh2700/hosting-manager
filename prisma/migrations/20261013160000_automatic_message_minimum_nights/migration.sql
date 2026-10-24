BEGIN;
ALTER TABLE automatic_message_rules ADD COLUMN minimum_nights INTEGER NOT NULL DEFAULT 1
  CHECK (minimum_nights BETWEEN 1 AND 365);
COMMIT;
