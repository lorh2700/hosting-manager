-- One-time operator script, NOT an automatic migration.
-- Stop application writes and take a DB backup first. Run the ENTIRE statement.
-- Exact source ID supplied by the operator; do not reuse for other people.
-- Retains the admin login and the cleaner's existing public schedule link.
-- The admin's previous public link is replaced (stored in the restricted archive).
DO $merge_users$
DECLARE
  source_id TEXT := 'staff-TWILlfEkjFh1FIJI60wK';
  target_id TEXT := '35f34482-ff4e-4d15-a5c0-721c35a463cc';
  src users%ROWTYPE;
  dst users%ROWTYPE;
  col RECORD;
  fk RECORD;
  remaining BIGINT;
  expected_cleanings BIGINT;
  source_scope JSONB;
BEGIN
  IF source_id='REPLACE_WITH_EXACT_STAFF_USER_ID' OR source_id=target_id THEN
    RAISE EXCEPTION 'Set the exact reviewed source user ID first';
  END IF;
  LOCK TABLE users, user_properties, cleanings, invitations, staff_identity_map IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO STRICT src FROM users WHERE id=source_id;
  SELECT * INTO STRICT dst FROM users WHERE id=target_id;
  IF src.role<>'cleaner' OR src.status<>'no_account' OR src.password<>''
    OR src.id NOT LIKE 'staff-%' OR src.email<>src.id || '@staff.invalid'
    OR src.display_name IS DISTINCT FROM '민들레'
    OR dst.display_name IS DISTINCT FROM '민들레'
    OR dst.email<>'min@test.com' OR dst.role<>'admin' OR dst.status<>'active' THEN
    RAISE EXCEPTION 'Account details differ from the reviewed pair; nothing merged';
  END IF;
  IF NULLIF(src.phone,'') IS NULL OR NULLIF(src.public_token,'') IS NULL THEN
    RAISE EXCEPTION 'Source phone or public schedule link is missing';
  END IF;
  IF NULLIF(dst.phone,'') IS NOT NULL AND
    regexp_replace(dst.phone,'[^0-9]','','g')<>regexp_replace(src.phone,'[^0-9]','','g') THEN
    RAISE EXCEPTION 'Phone conflict; nothing merged';
  END IF;
  IF EXISTS(SELECT 1 FROM properties WHERE owner_id=source_id)
    OR EXISTS(SELECT 1 FROM tour_operators WHERE owner_id=source_id)
    OR EXISTS(SELECT 1 FROM tours WHERE owner_id=source_id)
    OR EXISTS(SELECT 1 FROM users WHERE owner_id=source_id) THEN
    RAISE EXCEPTION 'Source has management ownership; review separately';
  END IF;
  IF (SELECT count(*) FROM staff_identity_map WHERE user_id=source_id AND migrated_at IS NOT NULL)<>1
    OR EXISTS(SELECT 1 FROM staff_identity_map WHERE user_id=target_id) THEN
    RAISE EXCEPTION 'Identity mapping differs from the reviewed pair; review separately';
  END IF;

  CREATE TABLE IF NOT EXISTS staff_user_merge_archive (
    source_user_id TEXT PRIMARY KEY,
    target_user_id TEXT NOT NULL,
    source_before JSONB NOT NULL,
    target_before JSONB NOT NULL,
    source_scope JSONB NOT NULL,
    cleaning_ids JSONB NOT NULL,
    invitations_before JSONB NOT NULL,
    merged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE staff_user_merge_archive ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON staff_user_merge_archive FROM PUBLIC;
  FOR col IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    EXECUTE format('REVOKE ALL ON staff_user_merge_archive FROM %I', col.rolname);
  END LOOP;
  SELECT COALESCE(jsonb_agg(property_id),'[]') INTO source_scope FROM user_properties WHERE user_id=source_id;
  INSERT INTO staff_user_merge_archive(source_user_id,target_user_id,source_before,target_before,source_scope,cleaning_ids,invitations_before)
  VALUES(source_id,target_id,to_jsonb(src),to_jsonb(dst),source_scope,
    (SELECT COALESCE(jsonb_agg(id),'[]') FROM cleanings WHERE cleaner_id=source_id),
    (SELECT COALESCE(jsonb_agg(to_jsonb(i)),'[]') FROM invitations i WHERE cleaner_id=source_id OR invited_by=source_id));
  SELECT count(*) INTO expected_cleanings FROM cleanings WHERE cleaner_id IN (source_id,target_id);

  -- Release the UNIQUE token before transferring it; the DO statement is atomic.
  UPDATE users SET public_token=NULL WHERE id=source_id;
  UPDATE users SET phone=COALESCE(NULLIF(dst.phone,''),src.phone),
    public_token=src.public_token, notify_new_open=(dst.notify_new_open OR src.notify_new_open),
    updated_at=CURRENT_TIMESTAMP WHERE id=target_id;
  INSERT INTO user_properties(user_id,property_id)
    SELECT target_id,property_id FROM user_properties WHERE user_id=source_id
    ON CONFLICT DO NOTHING;
  DELETE FROM user_properties WHERE user_id=source_id;
  UPDATE cleanings SET cleaner_id=target_id WHERE cleaner_id=source_id;
  -- Pending cleaner invitations must not become invitations to the retained admin account.
  UPDATE invitations SET cleaner_id=target_id,
    status=CASE WHEN status='pending' THEN 'expired' ELSE status END WHERE cleaner_id=source_id;

  -- Explicit actor fields used by the application; immutable historical snapshots stay unchanged.
  FOR col IN SELECT c.table_name,c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
      AND c.column_name IN ('applicant_id','processed_by','reported_by','resolved_by','requested_by','reviewed_by','created_by','triggered_by','invited_by')
      AND c.table_name NOT LIKE 'legacy_%' AND c.table_name NOT LIKE 'staff_%'
  LOOP
    EXECUTE format('UPDATE public.%I SET %I=$1 WHERE %I=$2',col.table_name,col.column_name,col.column_name)
      USING target_id,source_id;
  END LOOP;
  UPDATE staff_identity_map SET user_id=target_id WHERE user_id=source_id;

  -- Stop before DELETE if any FK would drop/null a remaining dependent row.
  FOR fk IN SELECT n.nspname,t.relname,a.attname,cardinality(c.conkey) AS key_count
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='public.users'::regclass
  LOOP
    IF fk.key_count<>1 THEN RAISE EXCEPTION 'Unsupported composite User foreign key'; END IF;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',fk.nspname,fk.relname,fk.attname)
      INTO remaining USING source_id;
    IF remaining>0 THEN
      RAISE EXCEPTION 'Unmoved reference in %.% (% rows); all changes rolled back',fk.relname,fk.attname,remaining;
    END IF;
  END LOOP;
  DELETE FROM users WHERE id=source_id;
  IF (SELECT count(*) FROM cleanings WHERE cleaner_id=target_id)<>expected_cleanings THEN
    RAISE EXCEPTION 'Cleaning count mismatch; all changes rolled back';
  END IF;
  RAISE NOTICE 'Merged into admin %. Total cleaning records: %',target_id,expected_cleanings;
END $merge_users$;
