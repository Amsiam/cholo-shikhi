CREATE TABLE "ledger_posting" (
	"posting_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account" text NOT NULL,
	"instructor_id" uuid,
	"amount_poisha" bigint NOT NULL,
	CONSTRAINT "ledger_posting_account_ck" CHECK ("ledger_posting"."account" in ('gateway_clearing', 'platform_revenue', 'instructor_payable', 'unassigned_instructor_pool')),
	CONSTRAINT "ledger_posting_instructor_ck" CHECK (("ledger_posting"."account" = 'instructor_payable') = ("ledger_posting"."instructor_id" is not null)),
	CONSTRAINT "ledger_posting_nonzero_ck" CHECK ("ledger_posting"."amount_poisha" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction" (
	"transaction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"source_payment_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"instructor_share_bps" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_tx_payment_uq" UNIQUE("source_payment_id"),
	CONSTRAINT "ledger_tx_kind_ck" CHECK ("ledger_transaction"."kind" in ('course_sale')),
	CONSTRAINT "ledger_tx_amount_ck" CHECK ("ledger_transaction"."amount_poisha" >= 0),
	CONSTRAINT "ledger_tx_bps_ck" CHECK ("ledger_transaction"."instructor_share_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_transaction_id_ledger_transaction_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transaction"("transaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_posting_tx_idx" ON "ledger_posting" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_posting_instructor_idx" ON "ledger_posting" USING btree ("instructor_id","account");--> statement-breakpoint
CREATE INDEX "ledger_tx_course_idx" ON "ledger_transaction" USING btree ("course_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_tx_occurred_idx" ON "ledger_transaction" USING btree ("occurred_at");--> statement-breakpoint
-- The ledger is append-only: a correction is a new, reversing transaction, never an edit.
CREATE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger rows are append-only (%)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER ledger_transaction_append_only BEFORE UPDATE OR DELETE ON "ledger_transaction"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();--> statement-breakpoint
CREATE TRIGGER ledger_posting_append_only BEFORE UPDATE OR DELETE ON "ledger_posting"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();--> statement-breakpoint
-- Every transaction balances (its postings sum to zero) and its gateway debit equals its amount.
-- Deferred to commit, so a transaction's postings can be inserted one at a time.
CREATE FUNCTION ledger_transaction_balances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx uuid := coalesce(NEW.transaction_id, OLD.transaction_id);
  total bigint;
  debit bigint;
  expected bigint;
BEGIN
  SELECT coalesce(sum(amount_poisha), 0),
         coalesce(sum(amount_poisha) FILTER (WHERE account = 'gateway_clearing'), 0)
    INTO total, debit FROM ledger_posting WHERE transaction_id = tx;
  SELECT amount_poisha INTO expected FROM ledger_transaction WHERE transaction_id = tx;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (%)', tx, total USING ERRCODE = 'check_violation';
  END IF;
  IF debit <> expected THEN
    RAISE EXCEPTION 'ledger transaction % gateway debit % <> amount %', tx, debit, expected USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_posting_balances AFTER INSERT ON "ledger_posting"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_transaction_balances();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_transaction_balances AFTER INSERT ON "ledger_transaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_transaction_balances();--> statement-breakpoint
COMMENT ON COLUMN "ledger_transaction"."transaction_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_transaction"."kind" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_transaction"."source_payment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_transaction"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_transaction"."amount_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_transaction"."instructor_share_bps" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_transaction"."occurred_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_transaction"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_posting"."posting_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_posting"."transaction_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_posting"."account" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_posting"."instructor_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_posting"."amount_poisha" IS 'data-class C2 (Internal).';
