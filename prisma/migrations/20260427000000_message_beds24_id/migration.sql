-- Add Beds24 message ID for canonical dedup
ALTER TABLE "messages" ADD COLUMN "beds24_message_id" TEXT;
CREATE UNIQUE INDEX "messages_beds24_message_id_key" ON "messages"("beds24_message_id");
