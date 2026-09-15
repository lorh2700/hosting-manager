CREATE TABLE "inquiry_automation_settings" (
 "property_id" TEXT PRIMARY KEY REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "enabled" BOOLEAN NOT NULL DEFAULT false, "enabled_at" TIMESTAMP(3),
 "knowledge" TEXT NOT NULL DEFAULT '', "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "inquiry_conversations" (
 "event_id" TEXT PRIMARY KEY REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "paused" BOOLEAN NOT NULL DEFAULT false, "reason" TEXT, "resume_after" TIMESTAMP(3),
 "send_token" TEXT, "send_until" TIMESTAMP(3), "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "inquiry_jobs" (
 "message_id" TEXT PRIMARY KEY REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "event_id" TEXT NOT NULL REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "property_id" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
 "lease_token" TEXT, "lease_until" TIMESTAMP(3),
 "draft" TEXT NOT NULL DEFAULT '', "summary" TEXT NOT NULL DEFAULT '', "reason" TEXT NOT NULL DEFAULT '',
 "evidence" JSONB NOT NULL DEFAULT '[]', "knowledge_version" TIMESTAMP(3), "outbound_id" TEXT,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "inquiry_jobs_status_created_at_idx" ON "inquiry_jobs"("status", "created_at");
CREATE INDEX "inquiry_jobs_event_id_created_at_idx" ON "inquiry_jobs"("event_id", "created_at");
CREATE TABLE "inquiry_notifications" (
 "id" TEXT PRIMARY KEY, "job_id" TEXT NOT NULL REFERENCES "inquiry_jobs"("message_id") ON DELETE CASCADE ON UPDATE CASCADE,
 "phone" TEXT NOT NULL, "name" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
 "attempts" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "provider_message_id" TEXT, "error" TEXT, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "inquiry_notifications_job_id_phone_key" ON "inquiry_notifications"("job_id", "phone");
CREATE INDEX "inquiry_notifications_status_next_attempt_at_idx" ON "inquiry_notifications"("status", "next_attempt_at");
ALTER TABLE "messages" ADD COLUMN "automated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inquiry_automation_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inquiry_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inquiry_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inquiry_notifications" ENABLE ROW LEVEL SECURITY;
