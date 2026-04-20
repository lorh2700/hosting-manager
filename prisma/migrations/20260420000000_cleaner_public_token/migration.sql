-- Add public_token column for cleaner-specific iCal / public calendar URLs
ALTER TABLE "cleaners" ADD COLUMN "public_token" TEXT;

-- Backfill existing rows with random tokens (gen_random_uuid returns 36-char uuid)
UPDATE "cleaners"
SET "public_token" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "public_token" IS NULL;

-- Enforce uniqueness
CREATE UNIQUE INDEX "cleaners_public_token_key" ON "cleaners"("public_token");
