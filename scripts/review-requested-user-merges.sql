-- Read-only review of the additional pairs explicitly identified by the operator.
-- Preserve byha2613's existing FULL email address; do not invent an email domain.
WITH selected AS (
  SELECT u.*,
    CASE WHEN btrim(display_name) IN ('정원','윤나') THEN '정원 / 윤나'
      ELSE 'byha2613 / 소현' END AS merge_group
  FROM users u
  WHERE btrim(display_name) IN ('정원','윤나','byha2613','소현')
    OR lower(split_part(email,'@',1))='byha2613'
)
SELECT merge_group,id AS user_id,display_name,email,phone,role,status,
  (NULLIF(password,'') IS NOT NULL) AS has_password,
  (NULLIF(public_token,'') IS NOT NULL) AS has_schedule_link,
  (SELECT count(*) FROM cleanings c WHERE c.cleaner_id=u.id) AS cleaning_count,
  ARRAY(SELECT property_id FROM user_properties WHERE user_id=u.id ORDER BY property_id) AS assigned_property_ids,
  (SELECT count(*) FROM properties p WHERE p.owner_id=u.id) AS owned_property_count,
  (SELECT count(*) FROM users s WHERE s.owner_id=u.id) AS owned_staff_count,
  (SELECT count(*) FROM tour_operators t WHERE t.owner_id=u.id) AS owned_tour_operator_count,
  (SELECT count(*) FROM tours t WHERE t.owner_id=u.id) AS owned_tour_count,
  ARRAY(SELECT cleaner_id FROM staff_identity_map m WHERE m.user_id=u.id) AS legacy_cleaner_ids
FROM selected u ORDER BY merge_group,display_name,id;
