-- CreateTable
CREATE TABLE "tour_duration_options" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "label" TEXT,
    "duration_min" INTEGER NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_duration_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tour_duration_options_tour_id_idx" ON "tour_duration_options"("tour_id");

-- AddForeignKey
ALTER TABLE "tour_duration_options" ADD CONSTRAINT "tour_duration_options_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: tour_bookings — booking-time snapshot of chosen course
ALTER TABLE "tour_bookings" ADD COLUMN "duration_option_id" TEXT;
ALTER TABLE "tour_bookings" ADD COLUMN "duration_min" INTEGER;
ALTER TABLE "tour_bookings" ADD COLUMN "unit_price" DECIMAL(65,30);

-- AddForeignKey
ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_duration_option_id_fkey" FOREIGN KEY ("duration_option_id") REFERENCES "tour_duration_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
