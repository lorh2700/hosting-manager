-- Run during a maintenance window with a verified database backup.
-- Optional staff_identity_map overrides MUST be reviewed by a person, never matched by name.
BEGIN;
LOCK TABLE users, cleaners, cleaner_properties, user_properties, cleanings, invitations IN ACCESS EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS staff_identity_map (
  cleaner_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  source_user_id TEXT,
  migrated_at TIMESTAMP(3)
);
ALTER TABLE staff_identity_map ENABLE ROW LEVEL SECURITY;
INSERT INTO staff_identity_map (cleaner_id, user_id, source_user_id)
SELECT id, COALESCE(user_id, 'staff-' || id), user_id FROM cleaners
ON CONFLICT (cleaner_id) DO NOTHING;
UPDATE staff_identity_map m SET source_user_id = c.user_id FROM cleaners c WHERE c.id = m.cleaner_id;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM staff_identity_map m LEFT JOIN cleaners c ON c.id=m.cleaner_id WHERE c.id IS NULL) THEN
    RAISE EXCEPTION 'Unknown cleaner in staff_identity_map';
  END IF;
  IF EXISTS (SELECT 1 FROM staff_identity_map m LEFT JOIN users u ON u.id=m.user_id WHERE u.id IS NULL AND m.user_id <> 'staff-' || m.cleaner_id) THEN
    RAISE EXCEPTION 'Explicit mapping target must be an existing user';
  END IF;
  IF EXISTS (SELECT 1 FROM staff_identity_map m JOIN cleaners c ON c.id=m.cleaner_id JOIN users u ON u.id=m.user_id
    WHERE NULLIF(u.phone,'') IS NOT NULL AND NULLIF(c.phone,'') IS NOT NULL
      AND regexp_replace(u.phone,'[^0-9]','','g') <> regexp_replace(c.phone,'[^0-9]','','g')) THEN
    RAISE EXCEPTION 'Phone conflict: review users.phone and cleaners.phone before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM staff_identity_map m JOIN users u ON u.id=m.source_user_id
    WHERE m.source_user_id <> m.user_id AND (u.role <> 'cleaner'
      OR EXISTS(SELECT 1 FROM properties p WHERE p.owner_id=u.id)
      OR EXISTS(SELECT 1 FROM cleaners c WHERE c.owner_id=u.id)
      OR EXISTS(SELECT 1 FROM tour_operators t WHERE t.owner_id=u.id)
      OR EXISTS(SELECT 1 FROM tours t WHERE t.owner_id=u.id))) THEN
    RAISE EXCEPTION 'Source account has management ownership; resolve it before merging';
  END IF;
  IF EXISTS (SELECT 1 FROM staff_identity_map a JOIN staff_identity_map b ON a.source_user_id=b.user_id
    WHERE a.source_user_id <> a.user_id AND a.cleaner_id <> b.cleaner_id) THEN
    RAISE EXCEPTION 'Chained identity mappings are not supported';
  END IF;
END $$;

ALTER TABLE users ADD COLUMN owner_id TEXT;
ALTER TABLE users ADD COLUMN public_token TEXT;
ALTER TABLE users ADD COLUMN notify_new_open BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX users_public_token_key ON users(public_token);

-- No-login staff get a User row with unusable credentials. Their existing schedule link survives.
INSERT INTO users (id,email,password,display_name,phone,role,status,created_at,updated_at)
SELECT m.user_id, m.user_id || '@staff.invalid', '', c.name, c.phone, 'cleaner', 'no_account', c.created_at, CURRENT_TIMESTAMP
FROM cleaners c JOIN staff_identity_map m ON m.cleaner_id=c.id
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=m.user_id);

-- Snapshot data before removing the old identity paths; these archives are not application tables.
CREATE TABLE staff_identity_users_before AS
SELECT u.* FROM users u WHERE u.id IN (SELECT user_id FROM staff_identity_map UNION SELECT source_user_id FROM staff_identity_map);
ALTER TABLE staff_identity_users_before ENABLE ROW LEVEL SECURITY;

UPDATE users u SET phone=COALESCE(NULLIF(u.phone,''),c.phone),
  display_name=COALESCE(NULLIF(u.display_name,''),c.name),
  owner_id=CASE WHEN c.owner_id=u.id THEN NULL ELSE c.owner_id END,
  public_token=c.public_token, notify_new_open=c.notify_new_open
FROM cleaners c JOIN staff_identity_map m ON m.cleaner_id=c.id WHERE u.id=m.user_id;
UPDATE users SET public_token=replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','') WHERE public_token IS NULL;

CREATE TEMP TABLE staff_old_scope ON COMMIT DROP AS
SELECT m.user_id,p.property_id FROM cleaners c JOIN staff_identity_map m ON m.cleaner_id=c.id
JOIN cleaner_properties p ON p.cleaner_id=c.id WHERE NOT c.no_properties
UNION
SELECT m.user_id,p.id FROM cleaners c JOIN staff_identity_map m ON m.cleaner_id=c.id
JOIN properties p ON p.owner_id=c.owner_id
WHERE NOT c.no_properties AND NOT EXISTS(SELECT 1 FROM cleaner_properties cp WHERE cp.cleaner_id=c.id);

-- A shared scope must not silently grant a manager new reservation/management access.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM staff_old_scope s JOIN users u ON u.id=s.user_id
    WHERE u.role NOT IN ('admin','super_admin','cleaner') AND NOT EXISTS(
      SELECT 1 FROM user_properties up WHERE up.user_id=u.id AND up.property_id=s.property_id)) THEN
    RAISE EXCEPTION 'Manager cleaning scope exceeds management scope; review shared property assignments first';
  END IF;
END $$;
-- Cleaner-only roles inherit their effective old scope exactly; empty stays empty.
DELETE FROM user_properties up USING users u, staff_identity_map m WHERE up.user_id=u.id AND u.id=m.user_id AND u.role='cleaner';
INSERT INTO user_properties (user_id,property_id)
SELECT s.user_id,s.property_id FROM staff_old_scope s JOIN users u ON u.id=s.user_id WHERE u.role='cleaner'
ON CONFLICT DO NOTHING;

ALTER TABLE cleanings DROP CONSTRAINT cleanings_cleaner_id_fkey;
ALTER TABLE invitations DROP CONSTRAINT invitations_cleaner_id_fkey;
UPDATE cleanings x SET cleaner_id=m.user_id FROM staff_identity_map m WHERE x.cleaner_id=m.cleaner_id;
UPDATE invitations x SET cleaner_id=m.user_id FROM staff_identity_map m WHERE x.cleaner_id=m.cleaner_id;
ALTER TABLE cleanings ADD CONSTRAINT cleanings_cleaner_id_fkey FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE invitations ADD CONSTRAINT invitations_cleaner_id_fkey FOREIGN KEY (cleaner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Move raw actor references when an explicitly mapped duplicate login is removed.
DO $$ DECLARE col RECORD; BEGIN
  FOR col IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('applicant_id','processed_by','reported_by','resolved_by','requested_by','reviewed_by','created_by','triggered_by','invited_by')
      AND table_name NOT LIKE 'staff_identity_%'
  LOOP
    EXECUTE format('UPDATE %I x SET %I=m.user_id FROM staff_identity_map m WHERE m.source_user_id IS NOT NULL AND m.source_user_id<>m.user_id AND x.%I=m.source_user_id',col.table_name,col.column_name,col.column_name);
  END LOOP;
END $$;
UPDATE users u SET owner_id=m.user_id FROM staff_identity_map m WHERE u.owner_id=m.source_user_id AND m.source_user_id<>m.user_id;

-- Preserve the old profile rows and IDs as read-only migration archives.
ALTER TABLE cleaners DROP CONSTRAINT cleaners_user_id_fkey;
ALTER TABLE cleaners DROP CONSTRAINT cleaners_owner_id_fkey;
ALTER TABLE cleaners RENAME TO legacy_cleaners;
ALTER TABLE cleaner_properties RENAME TO legacy_cleaner_properties;
ALTER TABLE legacy_cleaner_properties DROP CONSTRAINT cleaner_properties_property_id_fkey;
ALTER TABLE legacy_cleaners ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_cleaner_properties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON legacy_cleaners, legacy_cleaner_properties, staff_identity_map, staff_identity_users_before FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON legacy_cleaners, legacy_cleaner_properties, staff_identity_map, staff_identity_users_before FROM %I',r);
    END IF;
  END LOOP;
END $$;

DELETE FROM users u USING staff_identity_map m WHERE u.id=m.source_user_id AND m.source_user_id<>m.user_id;
UPDATE staff_identity_map SET migrated_at=CURRENT_TIMESTAMP;
COMMIT;
