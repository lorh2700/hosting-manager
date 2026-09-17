-- After merging, expect only the admin row named 도영 with the transferred cleanings.
SELECT u.id,u.display_name,u.email,u.phone,u.role,u.status,
  (SELECT count(*) FROM cleanings c WHERE c.cleaner_id=u.id) AS cleaning_count
FROM users u WHERE u.id IN (
  '6f53c2b2-2653-42ec-bf1a-0d2cc5b71077',
  'staff-vFeH4skk3leswVgev6kZ'
);
