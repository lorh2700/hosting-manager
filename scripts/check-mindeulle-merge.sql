-- Read-only verification after merge-mindeulle-users.sql.
SELECT id,display_name,email,phone,role,status,
  (SELECT count(*) FROM cleanings c WHERE c.cleaner_id=u.id) AS cleaning_count
FROM users u
WHERE id IN ('35f34482-ff4e-4d15-a5c0-721c35a463cc','staff-TWILlfEkjFh1FIJI60wK');
