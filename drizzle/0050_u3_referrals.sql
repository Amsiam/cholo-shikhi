CREATE TABLE "referral_attribution" (
	"referred_user_id" uuid PRIMARY KEY NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"attributed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_attribution_self_ck" CHECK ("referral_attribution"."referred_user_id" <> "referral_attribution"."referrer_user_id")
);
--> statement-breakpoint
CREATE TABLE "referral_code" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_code_code_uq" UNIQUE("code"),
	CONSTRAINT "referral_code_code_ck" CHECK ("referral_code"."code" ~ '^[A-HJ-NP-Z2-9]{10}$')
);
--> statement-breakpoint
ALTER TABLE "ledger_posting" DROP CONSTRAINT "ledger_posting_account_ck";--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_tx_kind_ck";--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_tx_course_ck";--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD COLUMN "referrer_id" uuid;--> statement-breakpoint
CREATE INDEX "referral_attribution_referrer_idx" ON "referral_attribution" USING btree ("referrer_user_id","attributed_at");--> statement-breakpoint
CREATE INDEX "ledger_posting_referrer_idx" ON "ledger_posting" USING btree ("referrer_id","account");--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_referrer_ck" CHECK (("ledger_posting"."account" = 'referral_payable') = ("ledger_posting"."referrer_id" is not null));--> statement-breakpoint
ALTER TABLE "ledger_posting" ADD CONSTRAINT "ledger_posting_account_ck" CHECK ("ledger_posting"."account" in ('gateway_clearing', 'platform_revenue', 'instructor_payable', 'unassigned_instructor_pool', 'referral_payable', 'referral_expense'));--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_kind_ck" CHECK ("ledger_transaction"."kind" in ('course_sale', 'course_refund', 'platform_sale', 'instructor_payout', 'referral_accrual', 'referral_clawback', 'referral_payout'));--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_course_ck" CHECK ("ledger_transaction"."kind" in ('platform_sale', 'instructor_payout', 'referral_accrual', 'referral_clawback', 'referral_payout') or "ledger_transaction"."course_id" is not null);--> statement-breakpoint
COMMENT ON COLUMN "referral_code"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_code"."code" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_code"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_attribution"."referred_user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_attribution"."referrer_user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_attribution"."code" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_attribution"."attributed_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "ledger_posting"."referrer_id" IS 'data-class C3 (Personal).';
