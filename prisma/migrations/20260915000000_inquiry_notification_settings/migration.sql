CREATE TABLE "inquiry_notification_settings" (
    "property_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inquiry_notification_settings_pkey" PRIMARY KEY ("property_id"),
    CONSTRAINT "inquiry_notification_settings_property_id_fkey"
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "inquiry_notification_settings" ENABLE ROW LEVEL SECURITY;
