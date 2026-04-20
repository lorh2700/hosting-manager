-- Link Cleaner records to their login User accounts
ALTER TABLE "cleaners" ADD COLUMN "user_id" TEXT;

CREATE UNIQUE INDEX "cleaners_user_id_key" ON "cleaners"("user_id");

ALTER TABLE "cleaners"
  ADD CONSTRAINT "cleaners_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
