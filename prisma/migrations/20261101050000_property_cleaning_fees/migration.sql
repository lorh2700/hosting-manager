ALTER TABLE properties ADD COLUMN refund_policy JSONB, ADD COLUMN cleaning_fee_policy JSONB;
ALTER TABLE cleanings ADD COLUMN pay_snapshot JSONB, ADD COLUMN pay_history JSONB NOT NULL DEFAULT '[]';

CREATE FUNCTION valid_property_cleaning_fee_policy(policy JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB; amount NUMERIC; seen TEXT[] := '{}'; day_value INTEGER; day_seen INTEGER[] := '{}';
BEGIN
  IF policy IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(policy) <> 'object' OR NOT policy ?& ARRAY['baseAmount','weekendDays','weekendAmount','payoutMode','specialFees']
    OR policy - ARRAY['baseAmount','weekendDays','weekendAmount','payoutMode','specialFees'] <> '{}'::jsonb THEN RETURN FALSE; END IF;
  IF jsonb_typeof(policy->'payoutMode') <> 'string' OR policy->>'payoutMode' NOT IN ('per_person','split') THEN RETURN FALSE; END IF;
  FOREACH item IN ARRAY ARRAY[policy->'baseAmount',policy->'weekendAmount'] LOOP
    IF jsonb_typeof(item) <> 'number' THEN RETURN FALSE; END IF;
    amount := item::text::numeric;
    IF amount <> trunc(amount) OR amount < 0 OR amount > 10000000 THEN RETURN FALSE; END IF;
  END LOOP;
  IF jsonb_typeof(policy->'weekendDays') <> 'array' OR jsonb_array_length(policy->'weekendDays') > 7 THEN RETURN FALSE; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(policy->'weekendDays') LOOP
    IF jsonb_typeof(item) <> 'number' OR item::text::numeric <> trunc(item::text::numeric) THEN RETURN FALSE; END IF;
    day_value := item::text::integer;
    IF day_value < 0 OR day_value > 6 OR day_value = ANY(day_seen) THEN RETURN FALSE; END IF;
    day_seen := array_append(day_seen,day_value);
  END LOOP;
  IF jsonb_typeof(policy->'specialFees') <> 'array' OR jsonb_array_length(policy->'specialFees') > 100 THEN RETURN FALSE; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(policy->'specialFees') LOOP
    IF jsonb_typeof(item) <> 'object' OR NOT item ?& ARRAY['id','name','from','to','amount']
      OR item - ARRAY['id','name','from','to','amount'] <> '{}'::jsonb THEN RETURN FALSE; END IF;
    IF jsonb_typeof(item->'id') <> 'string' OR (item->>'id') !~ '^[A-Za-z0-9_-]{1,100}$' OR item->>'id' = ANY(seen)
      OR jsonb_typeof(item->'name') <> 'string' OR length(btrim(item->>'name')) NOT BETWEEN 1 AND 100 THEN RETURN FALSE; END IF;
    seen := array_append(seen,item->>'id');
    IF jsonb_typeof(item->'from') <> 'string' OR jsonb_typeof(item->'to') <> 'string'
      OR item->>'from' !~ '^\d{4}-\d{2}-\d{2}$' OR item->>'to' !~ '^\d{4}-\d{2}-\d{2}$'
      OR item->>'from' < '2000-01-01' OR item->>'to' > '2100-12-31' OR item->>'from' > item->>'to'
      OR to_char((item->>'from')::date,'YYYY-MM-DD') <> item->>'from' OR to_char((item->>'to')::date,'YYYY-MM-DD') <> item->>'to' THEN RETURN FALSE; END IF;
    IF jsonb_typeof(item->'amount') <> 'number' THEN RETURN FALSE; END IF;
    amount := (item->>'amount')::numeric;
    IF amount <> trunc(amount) OR amount < 0 OR amount > 10000000 THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

CREATE FUNCTION valid_property_refund_policy(policy JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB; previous_day INTEGER := -1; previous_percent INTEGER := -1; day_value NUMERIC; percent NUMERIC;
BEGIN
  IF policy IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(policy) <> 'object' OR NOT policy ? 'tiers' OR policy - 'tiers' <> '{}'::jsonb
    OR jsonb_typeof(policy->'tiers') <> 'array' OR jsonb_array_length(policy->'tiers') NOT BETWEEN 2 AND 52 THEN RETURN FALSE; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(policy->'tiers') LOOP
    IF jsonb_typeof(item) <> 'object' OR NOT item ?& ARRAY['minDaysBefore','refundPercent']
      OR item - ARRAY['minDaysBefore','refundPercent'] <> '{}'::jsonb OR jsonb_typeof(item->'minDaysBefore') <> 'number'
      OR jsonb_typeof(item->'refundPercent') <> 'number' THEN RETURN FALSE; END IF;
    day_value := (item->>'minDaysBefore')::numeric; percent := (item->>'refundPercent')::numeric;
    IF day_value <> trunc(day_value) OR day_value NOT BETWEEN 0 AND 3650 OR percent <> trunc(percent) OR percent NOT BETWEEN 0 AND 100
      OR day_value <= previous_day OR percent < previous_percent OR (previous_day = -1 AND day_value <> 0) THEN RETURN FALSE; END IF;
    previous_day := day_value; previous_percent := percent;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
ALTER TABLE properties ADD CONSTRAINT properties_cleaning_fee_policy_valid CHECK (valid_property_cleaning_fee_policy(cleaning_fee_policy)),
  ADD CONSTRAINT properties_refund_policy_valid CHECK (valid_property_refund_policy(refund_policy));

CREATE FUNCTION snapshot_cleaning_pay() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE policy JSONB; specials JSONB := '[]'; people JSONB := '[]'; person RECORD; participant_count INTEGER;
  base_amount BIGINT; weekend_amount BIGINT; special_amount BIGINT; base_share BIGINT; weekend_share BIGINT; special_share BIGINT;
  total_payout BIGINT := 0; ordinal INTEGER := 0; at_time TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.pay_snapshot IS NOT NULL OR OLD.pay_history <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Cancel the cleaning instead of deleting payment history' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pay_snapshot IS DISTINCT FROM OLD.pay_snapshot OR NEW.pay_history IS DISTINCT FROM OLD.pay_history THEN
      RAISE EXCEPTION 'Cleaning payment snapshots are managed by completion transitions' USING ERRCODE='23514';
    END IF;
    IF OLD.status = 'done' AND NEW.status = 'done' THEN
      IF OLD.pay_snapshot IS NOT NULL AND (NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.date IS DISTINCT FROM OLD.date OR NEW.origin IS DISTINCT FROM OLD.origin
        OR NEW.cleaner_id IS DISTINCT FROM OLD.cleaner_id OR NEW.assistant_cleaner_id IS DISTINCT FROM OLD.assistant_cleaner_id
        OR NEW.external_cleaner_name IS DISTINCT FROM OLD.external_cleaner_name) THEN
        RAISE EXCEPTION 'Reopen the cleaning before changing confirmed payment participants or date' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status = 'done' AND NEW.status <> 'done' THEN
      IF OLD.pay_snapshot IS NOT NULL THEN NEW.pay_history := OLD.pay_history || jsonb_build_array(jsonb_build_object(
        'snapshot',OLD.pay_snapshot,'voidedAt',at_time,'nextStatus',NEW.status)); END IF;
      NEW.pay_snapshot := NULL;
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.pay_snapshot IS NOT NULL OR NEW.pay_history <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Cleaning payment snapshots cannot be supplied on creation' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  SELECT cleaning_fee_policy INTO policy FROM properties WHERE id=NEW.property_id FOR SHARE;
  IF policy IS NULL THEN RETURN NEW; END IF;
  base_amount := (policy->>'baseAmount')::bigint;
  weekend_amount := CASE WHEN policy->'weekendDays' @> to_jsonb(extract(dow FROM NEW.date::date)::integer)
    THEN (policy->>'weekendAmount')::bigint ELSE 0 END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','name',value->>'name','amount',(value->>'amount')::bigint) ORDER BY ord),'[]'::jsonb),
    coalesce(sum((value->>'amount')::bigint),0) INTO specials,special_amount
    FROM jsonb_array_elements(policy->'specialFees') WITH ORDINALITY AS fees(value,ord)
    WHERE value->>'from' <= NEW.date AND value->>'to' >= NEW.date;
  participant_count := CASE WHEN NEW.cleaner_id IS NULL THEN 0 ELSE 1 END
    + CASE WHEN NEW.assistant_cleaner_id IS NULL OR NEW.assistant_cleaner_id IS NOT DISTINCT FROM NEW.cleaner_id THEN 0 ELSE 1 END;
  FOR person IN SELECT ids.id,ids.role,u.display_name AS name FROM
    (VALUES (NEW.cleaner_id,'primary',0),(NEW.assistant_cleaner_id,'assistant',1)) AS ids(id,role,ordering)
    LEFT JOIN users u ON u.id=ids.id WHERE ids.id IS NOT NULL AND (ids.role='primary' OR ids.id IS DISTINCT FROM NEW.cleaner_id) ORDER BY ids.ordering LOOP
    IF policy->>'payoutMode' = 'per_person' THEN base_share := base_amount; weekend_share := weekend_amount; special_share := special_amount;
    ELSE
      base_share := base_amount / participant_count + CASE WHEN ordinal=0 THEN base_amount % participant_count ELSE 0 END;
      weekend_share := weekend_amount / participant_count + CASE WHEN ordinal=0 THEN weekend_amount % participant_count ELSE 0 END;
      special_share := special_amount / participant_count + CASE WHEN ordinal=0 THEN special_amount % participant_count ELSE 0 END;
    END IF;
    people := people || jsonb_build_array(jsonb_build_object('id',person.id,'role',person.role,'name',person.name,
      'baseAmount',base_share,'weekendAmount',weekend_share,'specialAmount',special_share,'totalAmount',base_share+weekend_share+special_share));
    total_payout := total_payout + base_share+weekend_share+special_share; ordinal := ordinal+1;
  END LOOP;
  NEW.pay_snapshot := jsonb_build_object('state','confirmed','currency','KRW','payoutMode',policy->>'payoutMode',
    'baseAmount',base_amount,'weekendAmount',weekend_amount,'specialAmount',special_amount,'totalAmount',base_amount+weekend_amount+special_amount,
    'totalPayout',total_payout,'specialFees',specials,'participants',people,'confirmedAt',at_time,
    'date',NEW.date,'propertyId',NEW.property_id,'origin',NEW.origin,'externalCleanerName',NEW.external_cleaner_name,'policy',policy);
  RETURN NEW;
END $$;
CREATE TRIGGER cleanings_payment_snapshot BEFORE INSERT OR UPDATE OR DELETE ON cleanings FOR EACH ROW EXECUTE FUNCTION snapshot_cleaning_pay();
