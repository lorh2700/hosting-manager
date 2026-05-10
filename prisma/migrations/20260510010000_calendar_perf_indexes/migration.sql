-- Calendar query perf indexes.
--
-- The /api/admin/calendar endpoint filters events by
--   propertyId IN (...) AND endDate >= rangeFrom AND startDate <= rangeTo
-- and bookings by
--   propertyId IN (...) AND status = 'confirmed' AND checkOut >= rangeFrom AND checkIn <= rangeTo
--
-- Existing indexes ([propertyId, type] / [propertyId, status]) help with
-- the property scope but not the date range, so under realistic data
-- volume Postgres falls back to a heap scan within each property bucket.
-- These composite indexes turn that into a range scan.
--
-- Note: not using CONCURRENTLY because Supabase SQL Editor wraps
-- statements in a transaction. At current data volume the brief
-- ACCESS EXCLUSIVE lock is negligible.

CREATE INDEX IF NOT EXISTS "events_property_id_end_date_idx"
  ON "events" ("property_id", "end_date");

CREATE INDEX IF NOT EXISTS "bookings_property_id_status_check_out_idx"
  ON "bookings" ("property_id", "status", "check_out");

-- Dashboard count queries scoped to user properties.
-- These are filter-only counts so the composite indexes let postgres
-- answer them with an index-only scan.

CREATE INDEX IF NOT EXISTS "messages_property_id_sender_read_idx"
  ON "messages" ("property_id", "sender", "read");

CREATE INDEX IF NOT EXISTS "supply_todos_property_id_done_idx"
  ON "supply_todos" ("property_id", "done");

CREATE INDEX IF NOT EXISTS "cleaning_applications_property_id_status_idx"
  ON "cleaning_applications" ("property_id", "status");
