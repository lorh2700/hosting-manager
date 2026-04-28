-- Beds24 v2 POST /bookings requires roomId (not propertyId).
-- Stored values in beds24_prop_id are actual propertyIds; add a separate
-- column for roomId.
ALTER TABLE "properties" ADD COLUMN "beds24_room_id" TEXT;
