-- Refunds (migration 0025) reverse a sale: their gateway line is a credit of the refunded amount.
-- Every transaction still balances; a sale's gateway debit equals its amount and a refund's gateway
-- credit equals minus its amount.
CREATE OR REPLACE FUNCTION ledger_transaction_balances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx uuid := coalesce(NEW.transaction_id, OLD.transaction_id);
  total bigint;
  debit bigint;
  expected bigint;
  tx_kind text;
BEGIN
  SELECT coalesce(sum(amount_poisha), 0),
         coalesce(sum(amount_poisha) FILTER (WHERE account = 'gateway_clearing'), 0)
    INTO total, debit FROM ledger_posting WHERE transaction_id = tx;
  SELECT amount_poisha, kind INTO expected, tx_kind FROM ledger_transaction WHERE transaction_id = tx;
  IF tx_kind = 'course_refund' THEN
    expected := -expected;
  END IF;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (%)', tx, total USING ERRCODE = 'check_violation';
  END IF;
  IF debit <> expected THEN
    RAISE EXCEPTION 'ledger transaction % gateway line % <> expected %', tx, debit, expected USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
