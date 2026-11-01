ALTER TABLE "checkout_orders" ADD COLUMN "tour_selections" JSONB;

ALTER TABLE "checkout_orders" ADD CONSTRAINT "checkout_orders_tour_selections_shape"
CHECK (("tour_selections" IS NULL OR (
  jsonb_typeof("tour_selections") = 'object'
  AND "tour_selections" -> 'version' = '1'::jsonb
  AND jsonb_typeof("tour_selections" -> 'selections') = 'array'
  AND jsonb_array_length("tour_selections" -> 'selections') <= 3
)) IS TRUE);

ALTER TABLE "tour_bookings"
  ADD COLUMN "request_key" TEXT,
  ADD COLUMN "request_hash" TEXT;

ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_request_identity"
CHECK (("request_key" IS NULL AND "request_hash" IS NULL) OR (
  "request_key" IS NOT NULL AND "request_hash" IS NOT NULL
  AND "request_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND "request_hash" ~ '^[0-9a-f]{64}$'
));

CREATE UNIQUE INDEX "tour_bookings_request_tour_key" ON "tour_bookings"("request_key", "tour_id");

ALTER TABLE "tours" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "tours" ADD CONSTRAINT "tours_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "tours_organization_id_idx" ON "tours"("organization_id");
