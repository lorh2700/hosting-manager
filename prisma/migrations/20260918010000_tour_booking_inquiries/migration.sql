ALTER TABLE "tour_bookings" ALTER COLUMN "schedule_id" DROP NOT NULL;
ALTER TABLE "tour_bookings" ADD COLUMN "requested_date" TEXT,
  ADD COLUMN "requested_time" TEXT;
