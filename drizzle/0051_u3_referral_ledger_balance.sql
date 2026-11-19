-- Referral money (US8.7/US8.8) moves no cash at accrual or clawback: their gateway line is 0. A
-- referral payout takes cash out like an instructor payout: its gateway line is a credit of the
-- paid amount. Every transaction still balances to zero.
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
  IF tx_kind IN ('course_refund', 'instructor_payout', 'referral_payout') THEN
    expected := -expected;
  ELSIF tx_kind IN ('referral_accrual', 'referral_clawback') THEN
    expected := 0;
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
