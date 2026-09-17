-- Read-only candidates after the users identity migration.
-- Matching names/phones are clues, not proof of identity. Never delete by this result alone.
-- Deliberately excludes passwords and personal schedule tokens.
WITH normalized AS (
  SELECT id, display_name, email, phone, role, status,
    NULLIF(lower(btrim(display_name)), '') AS name_key,
    NULLIF(regexp_replace(phone, '[^0-9]', '', 'g'), '') AS phone_key
  FROM users
), pairs AS (
  SELECT a.id AS first_id, b.id AS second_id,
    CASE
      WHEN a.name_key=b.name_key AND a.phone_key=b.phone_key THEN 'same_name_and_phone'
      WHEN a.phone_key=b.phone_key THEN 'same_phone'
      ELSE 'same_name'
    END AS match_reason
  FROM normalized a JOIN normalized b ON a.id < b.id
    AND (a.name_key=b.name_key OR a.phone_key=b.phone_key)
), candidates AS (
  SELECT first_id AS user_id, second_id AS candidate_user_id, match_reason FROM pairs
  UNION ALL
  SELECT second_id, first_id, match_reason FROM pairs
)
SELECT c.match_reason, c.candidate_user_id,
  u.id AS user_id, u.display_name, u.email, u.phone, u.role, u.status,
  (SELECT count(*) FROM cleanings x WHERE x.cleaner_id=u.id) AS cleaning_count,
  ARRAY(SELECT up.property_id FROM user_properties up WHERE up.user_id=u.id
    ORDER BY up.property_id) AS assigned_property_ids,
  (SELECT count(*) FROM properties p WHERE p.owner_id=u.id) AS owned_property_count,
  (SELECT count(*) FROM users s WHERE s.owner_id=u.id) AS owned_staff_count
FROM candidates c JOIN normalized u ON u.id=c.user_id
ORDER BY u.display_name NULLS LAST, u.id, c.candidate_user_id;
