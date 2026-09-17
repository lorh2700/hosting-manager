-- Schema only: employee rows are merged explicitly after a preview, never by name.
CREATE TABLE "staff_merges" (
    "id" TEXT NOT NULL,
    "source_user_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "cleaner_id" TEXT NOT NULL,
    "performed_by" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_merges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_merges_source_user_id_key" ON "staff_merges"("source_user_id");
CREATE INDEX "staff_merges_target_user_id_idx" ON "staff_merges"("target_user_id");
ALTER TABLE "staff_merges" ENABLE ROW LEVEL SECURITY;
