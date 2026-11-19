ALTER TABLE "ledger_posting" DROP CONSTRAINT "ledger_posting_account_ck";--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_tx_kind_ck";--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_tx_course_ck";--> statement-breakpoint
ALTER TABLE "payout_line" DROP CONSTRAINT "payout_line_amounts_ck";--> statement-breakpoint
ALTER TABLE "payout_line" DROP CONSTRAINT "payout_line_conservation_ck";--> statement-breakpoint
ALTER TABLE "payout_cycle" ADD COLUMN "total_salary" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_line" ADD COLUMN "salary" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_account_ck" CHECK ("ledger_posting"."account" in ('gateway_clearing', 'platform_revenue', 'instructor_payable', 'unassigned_instructor_pool', 'referral_payable', 'referral_expense', 'salary_expense'));--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_kind_ck" CHECK ("ledger_transaction"."kind" in ('course_sale', 'course_refund', 'platform_sale', 'instructor_payout', 'referral_accrual', 'referral_clawback', 'referral_payout', 'attribution_reassignment', 'salary_accrual'));--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_course_ck" CHECK ("ledger_transaction"."kind" in ('platform_sale', 'instructor_payout', 'referral_accrual', 'referral_clawback', 'referral_payout', 'salary_accrual') or "ledger_transaction"."course_id" is not null);--> statement-breakpoint
ALTER TABLE "payout_line" ADD CONSTRAINT "payout_line_amounts_ck" CHECK ("payout_line"."payout" >= 0 and "payout_line"."carry_in" >= 0 and "payout_line"."carry_out" >= 0 and "payout_line"."salary" >= 0);--> statement-breakpoint
ALTER TABLE "payout_line" ADD CONSTRAINT "payout_line_conservation_ck" CHECK ("payout_line"."payout" - "payout_line"."carry_out" = "payout_line"."earned" + "payout_line"."salary" - "payout_line"."carry_in");--> statement-breakpoint
-- US7.16: a salary accrual moves no cash (salary_expense to the instructor's payable): its gateway
-- line is 0. Every transaction still balances to zero.
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
  ELSIF tx_kind IN ('referral_accrual', 'referral_clawback', 'attribution_reassignment', 'salary_accrual') THEN
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
$$;--> statement-breakpoint
-- A committed line's salary is locked like its other amounts.
CREATE OR REPLACE FUNCTION payout_snapshot_is_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- US7.3 (AC7.3.2): a committed cycle never changes, and a line's amounts never change;
  -- only a line's payment state, references and timestamps move forward.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout snapshot is locked: % rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'payout_cycle' THEN
    RAISE EXCEPTION 'payout snapshot is locked: a committed cycle cannot be edited' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.cycle_id IS DISTINCT FROM OLD.cycle_id OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
     OR NEW.earned IS DISTINCT FROM OLD.earned OR NEW.carry_in IS DISTINCT FROM OLD.carry_in
     OR NEW.payout IS DISTINCT FROM OLD.payout OR NEW.carry_out IS DISTINCT FROM OLD.carry_out
     OR NEW.salary IS DISTINCT FROM OLD.salary THEN
    RAISE EXCEPTION 'payout snapshot is locked: line amounts cannot be edited' USING ERRCODE = 'P0001';
  END IF;
  -- A paid line is final.
  IF OLD.state = 'disbursed' THEN
    RAISE EXCEPTION 'payout snapshot is locked: a disbursed line cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."total_salary" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."salary" IS 'data-class C3 (Personal).';
