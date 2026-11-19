CREATE TABLE "kyc_submission" (
	"submission_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"legal_name" text NOT NULL,
	"nid_number_sealed" text NOT NULL,
	"nid_masked" text NOT NULL,
	"front_object_key" text NOT NULL,
	"back_object_key" text NOT NULL,
	"front_sha256" text NOT NULL,
	"back_sha256" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reason" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "kyc_submission_status_ck" CHECK ("kyc_submission"."status" in ('submitted', 'verified', 'rejected')),
	CONSTRAINT "kyc_submission_party_ck" CHECK ("kyc_submission"."party_type" in ('instructor', 'referrer')),
	CONSTRAINT "kyc_submission_name_ck" CHECK (char_length("kyc_submission"."legal_name") between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "payout_account" (
	"payout_account_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rail" text NOT NULL,
	"account_name" text NOT NULL,
	"account_sealed" text NOT NULL,
	"account_masked" text NOT NULL,
	"bank_name" text,
	"branch_name" text,
	"routing_number" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "payout_account_rail_ck" CHECK ("payout_account"."rail" in ('bkash', 'nagad', 'bank')),
	CONSTRAINT "payout_account_status_ck" CHECK ("payout_account"."status" in ('pending', 'verified', 'rejected')),
	CONSTRAINT "payout_account_bank_ck" CHECK ("payout_account"."rail" <> 'bank' or ("payout_account"."bank_name" is not null and "payout_account"."routing_number" is not null))
);
--> statement-breakpoint
CREATE INDEX "kyc_submission_user_idx" ON "kyc_submission" USING btree ("user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "kyc_submission_queue_idx" ON "kyc_submission" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_account_current_uq" ON "payout_account" USING btree ("user_id") WHERE "payout_account"."is_current";--> statement-breakpoint
CREATE INDEX "payout_account_queue_idx" ON "payout_account" USING btree ("status","created_at");--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."submission_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."party_type" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."legal_name" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."nid_number_sealed" IS 'data-class C4 (Secret).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."nid_masked" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."front_object_key" IS 'data-class C4 (Secret).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."back_object_key" IS 'data-class C4 (Secret).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."front_sha256" IS 'data-class C4 (Secret).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."back_sha256" IS 'data-class C4 (Secret).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."status" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."submitted_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."decided_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "kyc_submission"."decided_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."payout_account_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."rail" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."account_name" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."account_sealed" IS 'data-class C4 (Secret).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."account_masked" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."bank_name" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."branch_name" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."routing_number" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."status" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."is_current" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."created_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."decided_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_account"."decided_by" IS 'data-class C3 (Personal).';