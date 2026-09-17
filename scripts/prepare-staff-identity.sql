-- Optional preparation BEFORE prisma migrate deploy. Read-only report follows table setup.
-- Do not match people by display name. Review phone/email and IDs with the operator.
CREATE TABLE IF NOT EXISTS staff_identity_map (
  cleaner_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  source_user_id TEXT,
  migrated_at TIMESTAMP(3)
);
ALTER TABLE staff_identity_map ENABLE ROW LEVEL SECURITY;
SELECT c.id AS cleaner_id, c.name, c.phone AS cleaner_phone,
  c.user_id AS linked_user_id, linked.email AS linked_email,
  candidate.id AS possible_user_id, candidate.display_name, candidate.email,
  candidate.role, candidate.phone AS user_phone
FROM cleaners c
LEFT JOIN users linked ON linked.id=c.user_id
LEFT JOIN users candidate ON (NULLIF(regexp_replace(candidate.phone,'[^0-9]','','g'),'') = NULLIF(regexp_replace(c.phone,'[^0-9]','','g'),'') OR candidate.display_name=c.name) AND candidate.id IS DISTINCT FROM c.user_id
ORDER BY c.name,c.id;
-- After identity review only, insert the exact IDs selected by the operator:
-- INSERT INTO staff_identity_map(cleaner_id,user_id) VALUES ('reviewed-cleaner-id','retained-user-id');
