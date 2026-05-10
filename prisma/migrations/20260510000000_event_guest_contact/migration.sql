-- Add structured guest contact + party-size columns to events.
-- Until now this info lived only inside the human-readable description text,
-- which is fragile to parse. welcome-pad's check-in matching needs structured
-- email/phone, so we promote them to real columns. Existing rows are NULL
-- until the next sync cycle backfills them.
ALTER TABLE "events" ADD COLUMN "guest_email" TEXT;
ALTER TABLE "events" ADD COLUMN "guest_phone" TEXT;
ALTER TABLE "events" ADD COLUMN "num_adults" INTEGER;
ALTER TABLE "events" ADD COLUMN "num_children" INTEGER;
