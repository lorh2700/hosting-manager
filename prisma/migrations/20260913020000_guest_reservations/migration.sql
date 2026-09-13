BEGIN;
ALTER TABLE "guests" ADD COLUMN "normalized_name" TEXT, ADD COLUMN "normalized_email" TEXT, ADD COLUMN "normalized_phone" TEXT;
CREATE INDEX "guests_normalized_name_idx" ON "guests"("normalized_name");
CREATE INDEX "guests_normalized_email_idx" ON "guests"("normalized_email");
CREATE INDEX "guests_normalized_phone_idx" ON "guests"("normalized_phone");
CREATE TABLE "guest_reservations" (
 "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "property_id" TEXT NOT NULL, "guest_id" TEXT,
 "name" TEXT, "email" TEXT, "phone" TEXT, "check_in" TEXT NOT NULL, "check_out" TEXT NOT NULL,
 "status" TEXT NOT NULL, "source" TEXT NOT NULL, "match_status" TEXT NOT NULL DEFAULT 'review',
 "match_reason" TEXT NOT NULL, "candidate_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "identity_signature" TEXT NOT NULL, "reviewed_by" TEXT, "reviewed_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "guest_reservations_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "guest_reservations_guest_id_status_idx" ON "guest_reservations"("guest_id", "status");
CREATE INDEX "guest_reservations_match_status_updated_at_idx" ON "guest_reservations"("match_status", "updated_at");
CREATE INDEX "guest_reservations_property_id_check_out_idx" ON "guest_reservations"("property_id", "check_out");
ALTER TABLE "guest_reservations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "guest_reservations" FROM anon, authenticated;

COMMIT;
