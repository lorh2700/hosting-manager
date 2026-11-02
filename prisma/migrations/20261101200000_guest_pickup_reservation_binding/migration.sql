-- Bind only new requests with a verified invitation. Existing receipts remain unchanged.
ALTER TABLE "guest_service_requests"
  ADD COLUMN "reservation_kind" TEXT,
  ADD COLUMN "reservation_id" TEXT,
  ADD CONSTRAINT "guest_service_requests_reservation_pair_check" CHECK (
    ("reservation_kind" IS NULL AND "reservation_id" IS NULL) OR
    ("reservation_kind" IS NOT NULL AND "reservation_kind" IN ('booking', 'event') AND "reservation_id" IS NOT NULL)
  );
CREATE INDEX "guest_service_requests_reservation_idx"
  ON "guest_service_requests" ("property_id", "reservation_kind", "reservation_id", "created_at");
