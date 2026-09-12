CREATE TABLE "checkout_orders" (
  "id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "property_id" TEXT NOT NULL,
  "room_id" INTEGER NOT NULL,
  "offer_id" INTEGER NOT NULL,
  "property_name" TEXT NOT NULL,
  "check_in" TEXT NOT NULL,
  "check_out" TEXT NOT NULL,
  "guests" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL CHECK ("amount_minor" > 0),
  "price_krw" INTEGER NOT NULL CHECK ("price_krw" > 0),
  "fx_rate" TEXT,
  "terms" TEXT NOT NULL,
  "terms_accepted_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'quoted',
  "beds24_id" TEXT,
  "payment_key" TEXT,
  "booking_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "lease_until" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "checkout_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkout_orders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "checkout_orders_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "checkout_orders_token_hash_key" ON "checkout_orders"("token_hash");
CREATE UNIQUE INDEX "checkout_orders_beds24_id_key" ON "checkout_orders"("beds24_id");
CREATE UNIQUE INDEX "checkout_orders_payment_key_key" ON "checkout_orders"("payment_key");
CREATE UNIQUE INDEX "checkout_orders_booking_id_key" ON "checkout_orders"("booking_id");
CREATE INDEX "checkout_orders_status_updated_at_idx" ON "checkout_orders"("status", "updated_at");
CREATE INDEX "checkout_orders_property_id_check_in_check_out_idx" ON "checkout_orders"("property_id", "check_in", "check_out");
-- Server-only table: never expose payment identifiers or guest details through Supabase anonymous APIs.
ALTER TABLE "checkout_orders" ENABLE ROW LEVEL SECURITY;
