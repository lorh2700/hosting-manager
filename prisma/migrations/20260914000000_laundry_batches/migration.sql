CREATE TABLE "laundry_batches" (
 "id" TEXT NOT NULL,
 "property_id" TEXT NOT NULL,
 "pickup_date" TEXT NOT NULL,
 "delivery_date" TEXT NOT NULL,
 "vendor" TEXT NOT NULL,
 "vendor_phone" TEXT NOT NULL DEFAULT '',
 "status" TEXT NOT NULL DEFAULT 'scheduled',
 "items" JSONB NOT NULL,
 "history" JSONB NOT NULL,
 "notes" TEXT NOT NULL DEFAULT '',
 "version" INTEGER NOT NULL DEFAULT 1,
 "created_by" TEXT NOT NULL,
 "collected_at" TIMESTAMP(3),
 "completed_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "laundry_batches_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "laundry_batches_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "laundry_batches_property_id_pickup_date_idx" ON "laundry_batches"("property_id", "pickup_date");
CREATE INDEX "laundry_batches_status_delivery_date_idx" ON "laundry_batches"("status", "delivery_date");
ALTER TABLE "laundry_batches" ENABLE ROW LEVEL SECURITY;
