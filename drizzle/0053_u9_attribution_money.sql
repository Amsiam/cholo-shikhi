CREATE TABLE "attribution_reassignment" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"total_poisha" bigint NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	CONSTRAINT "attribution_reassignment_total_ck" CHECK ("attribution_reassignment"."total_poisha" >= 0),
	CONSTRAINT "attribution_reassignment_posted_ck" CHECK (("attribution_reassignment"."posted_at" is null) = ("attribution_reassignment"."posted_by" is null))
);
--> statement-breakpoint
CREATE TABLE "attribution_reassignment_item" (
	"item_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"amount_poisha" bigint NOT NULL,
	CONSTRAINT "attribution_reassignment_item_uq" UNIQUE("payment_id","section_id"),
	CONSTRAINT "attribution_reassignment_item_amount_ck" CHECK ("attribution_reassignment_item"."amount_poisha" > 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_tx_kind_ck";--> statement-breakpoint
ALTER TABLE "attribution_reassignment" ADD CONSTRAINT "attribution_reassignment_case_id_attribution_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."attribution_case"("case_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_reassignment_item" ADD CONSTRAINT "attribution_reassignment_item_case_id_attribution_reassignment_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."attribution_reassignment"("case_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribution_reassignment_pending_idx" ON "attribution_reassignment" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "attribution_reassignment_item_case_idx" ON "attribution_reassignment_item" USING btree ("case_id");--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_kind_ck" CHECK ("ledger_transaction"."kind" in ('course_sale', 'course_refund', 'platform_sale', 'instructor_payout', 'referral_accrual', 'referral_clawback', 'referral_payout', 'attribution_reassignment'));--> statement-breakpoint
-- US7.13: an attribution reassignment moves money from the unassigned pool to an instructor's
-- payable and no cash: its gateway line is 0. Every transaction still balances to zero.
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
  ELSIF tx_kind IN ('referral_accrual', 'referral_clawback', 'attribution_reassignment') THEN
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
CREATE OR REPLACE FUNCTION attribution_reassignment_is_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attribution reassignment is locked: % rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'attribution_reassignment_item' THEN
    RAISE EXCEPTION 'attribution reassignment is locked: items cannot be edited' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.posted_at IS NOT NULL OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.course_id IS DISTINCT FROM OLD.course_id
     OR NEW.section_id IS DISTINCT FROM OLD.section_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.total_poisha IS DISTINCT FROM OLD.total_poisha OR NEW.computed_at IS DISTINCT FROM OLD.computed_at THEN
    RAISE EXCEPTION 'attribution reassignment is locked: only a pending one can be marked posted' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER attribution_reassignment_locked BEFORE UPDATE OR DELETE ON attribution_reassignment FOR EACH ROW EXECUTE FUNCTION attribution_reassignment_is_locked();--> statement-breakpoint
CREATE TRIGGER attribution_reassignment_item_locked BEFORE UPDATE OR DELETE ON attribution_reassignment_item FOR EACH ROW EXECUTE FUNCTION attribution_reassignment_is_locked();--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment"."case_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment"."section_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment"."owner_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment"."total_poisha" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment"."computed_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment"."posted_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment"."posted_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment_item"."item_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment_item"."case_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment_item"."payment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment_item"."section_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_reassignment_item"."amount_poisha" IS 'data-class C3 (Personal).';
