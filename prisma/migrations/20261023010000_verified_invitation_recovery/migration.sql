BEGIN;

INSERT INTO guest_link_tokens(token_hash,purpose,property_id,reservation_kind,reservation_id,expires_at)
SELECT '194c6e6467223a72b2f6c826891058f31165ab2f2d564a6bad9bf801ebd15650',
  'invitation',property_id,'event',id,to_timestamp(1795359600)
FROM events
WHERE id='86ab620a-3508-4855-adf1-4205ebb62eda'
  AND property_id='Z4jFeng2zG9WpAhWtow3'
  AND type='reservation' AND channel_id='beds24' AND original_uid='93826707'
  AND start_date='2026-10-23' AND end_date='2026-10-24'
ON CONFLICT(token_hash) DO NOTHING;

COMMIT;
