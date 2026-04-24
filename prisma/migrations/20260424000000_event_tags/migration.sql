-- Add tags column to events table
ALTER TABLE "events" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
