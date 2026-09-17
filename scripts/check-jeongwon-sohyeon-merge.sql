-- Expect one retained admin per person. Counts may grow with new assignments.
SELECT u.id,u.display_name,u.email,u.phone,u.role,u.status,
  (SELECT count(*) FROM cleanings c WHERE c.cleaner_id=u.id) AS cleaning_count
FROM users u WHERE u.id IN (
  '2aa9fb37-59f6-4a4b-ad6b-390f75420821',
  'a9b28d8d-c06e-40d9-a1a5-d46a040da3b5',
  '9168659e-3948-4a76-9e05-b252378ae62d'
) OR (u.display_name='윤나' AND regexp_replace(u.phone,'[^0-9]','','g')='01040887715')
ORDER BY u.display_name;
