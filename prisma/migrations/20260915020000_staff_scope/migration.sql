-- Preserve existing selected/all assignment behavior; explicit unassigned is opt-in.
ALTER TABLE "cleaners" ADD COLUMN "no_properties" BOOLEAN NOT NULL DEFAULT false;
