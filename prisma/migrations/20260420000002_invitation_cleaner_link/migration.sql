-- Add cleaner_id FK on invitations so a portal invite can link back to
-- the existing Cleaner record instead of auto-creating on registration.
ALTER TABLE "invitations" ADD COLUMN "cleaner_id" TEXT;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_cleaner_id_fkey"
  FOREIGN KEY ("cleaner_id") REFERENCES "cleaners"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce phone uniqueness on cleaners to prevent duplicate records for
-- the same person. NULL phones are still allowed to coexist (Postgres
-- treats NULLs as distinct in UNIQUE indexes).
-- NOTE: if existing rows have duplicate non-null phones, this migration
-- will fail. De-duplicate before running `prisma migrate deploy`.
CREATE UNIQUE INDEX "cleaners_phone_key" ON "cleaners"("phone");
