CREATE TABLE "tour_notification_settings" (
    "organization_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tour_notification_settings_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "tour_notification_settings_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "tour_notification_settings" ENABLE ROW LEVEL SECURITY;
