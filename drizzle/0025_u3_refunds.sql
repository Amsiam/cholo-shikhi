CREATE TABLE "refund_request" (
	"refund_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy" text,
	"refund_poisha" bigint,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "refund_status_ck" CHECK ("refund_request"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "refund_policy_ck" CHECK ("refund_request"."policy" is null or "refund_request"."policy" in ('full', 'unused', 'partial')),
	CONSTRAINT "refund_reason_ck" CHECK (char_length("refund_request"."reason") between 10 and 1000),
	CONSTRAINT "refund_decision_ck" CHECK (("refund_request"."status" = 'pending') = ("refund_request"."decided_at" is null) and ("refund_request"."status" <> 'approved' or ("refund_request"."policy" is not null and "refund_request"."refund_poisha" >= 1)))
);
--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_tx_payment_uq";--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_tx_kind_ck";--> statement-breakpoint
ALTER TABLE "refund_request" ADD CONSTRAINT "refund_request_payment_id_payment_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("payment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_payment_open_uq" ON "refund_request" USING btree ("payment_id") WHERE "refund_request"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "refund_status_idx" ON "refund_request" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "refund_user_idx" ON "refund_request" USING btree ("user_id","requested_at");--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_payment_kind_uq" UNIQUE("source_payment_id","kind");--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_kind_ck" CHECK ("ledger_transaction"."kind" in ('course_sale', 'course_refund'));--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."refund_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."payment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."requested_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."policy" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."refund_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."decision_note" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."decided_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "refund_request"."decided_at" IS 'data-class C2 (Internal).';
