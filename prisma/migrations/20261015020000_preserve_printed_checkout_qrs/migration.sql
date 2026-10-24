BEGIN;

INSERT INTO guest_link_tokens(token_hash,purpose,property_id) VALUES
('cddfc9c92ba57c7e793ba663edc60970bc5a202bbcca951ac0a79fe72873eaff','checkout','70X0HKDJasPU3RQj67aU'),
('99516806ab90e570b2fbe30c6aa50c13d262adfc189b1f7ccf1f21f73f9bb742','checkout','oKWKVQqLy7uENyHUwljr'),
('70f4987938c580bff108acf2508563a9c7b1a4c6a892309a68617c6a5d4f6cda','checkout','Z4jFeng2zG9WpAhWtow3'),
('e6eac7ecdc6c5481df6aaf5684efe25acef047819580b16efedd9d7385ee0053','checkout','5plQsEOe9sTHzSsMS0pc')
ON CONFLICT (token_hash) DO NOTHING;

COMMIT;
