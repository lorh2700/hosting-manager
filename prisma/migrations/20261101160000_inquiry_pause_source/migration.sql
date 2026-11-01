ALTER TABLE "inquiry_conversations"
  ADD COLUMN "pause_source" TEXT,
  ADD COLUMN "pause_message_id" TEXT,
  ADD CONSTRAINT "inquiry_conversations_pause_source_check"
    CHECK ("pause_source" IS NULL OR "pause_source" IN ('manual', 'automatic'));
