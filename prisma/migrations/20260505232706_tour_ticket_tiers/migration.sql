-- CreateTable: 투어 티켓 종류 (성인/어린이/영유아 같은 가격 티어)
CREATE TABLE "tour_ticket_tiers" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_ticket_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tour_ticket_tiers_tour_id_idx" ON "tour_ticket_tiers"("tour_id");

-- AddForeignKey
ALTER TABLE "tour_ticket_tiers" ADD CONSTRAINT "tour_ticket_tiers_tour_id_fkey"
  FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: tour_bookings — tier ticketing snapshot + booking metadata
ALTER TABLE "tour_bookings" ADD COLUMN "tickets" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE "tour_bookings" ADD COLUMN "language" TEXT;
ALTER TABLE "tour_bookings" ADD COLUMN "meeting_choice" TEXT;
ALTER TABLE "tour_bookings" ADD COLUMN "meeting_detail" TEXT;
