CREATE TABLE "referral_withdrawal" (
	"withdrawal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"rail" text NOT NULL,
	"account_masked" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	"provider_ref" text,
	CONSTRAINT "referral_withdrawal_amount_ck" CHECK ("referral_withdrawal"."amount_poisha" >= 1),
	CONSTRAINT "referral_withdrawal_status_ck" CHECK ("referral_withdrawal"."status" in ('requested', 'paid', 'rejected')),
	CONSTRAINT "referral_withdrawal_decided_ck" CHECK (("referral_withdrawal"."status" = 'requested') = ("referral_withdrawal"."decided_at" is null)),
	CONSTRAINT "referral_withdrawal_paid_ck" CHECK (("referral_withdrawal"."status" = 'paid') = ("referral_withdrawal"."provider_ref" is not null))
);
--> statement-breakpoint
ALTER TABLE "referral_code" ADD COLUMN "adult_declared_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_withdrawal_open_uq" ON "referral_withdrawal" USING btree ("user_id") WHERE "referral_withdrawal"."status" = 'requested';--> statement-breakpoint
CREATE INDEX "referral_withdrawal_status_idx" ON "referral_withdrawal" USING btree ("status","requested_at");--> statement-breakpoint
COMMENT ON COLUMN "referral_code"."adult_declared_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."withdrawal_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."amount_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."rail" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."account_masked" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."requested_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."decided_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."decided_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "referral_withdrawal"."provider_ref" IS 'data-class C2 (Internal).';
