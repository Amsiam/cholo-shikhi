CREATE TABLE "fraud_flag" (
	"flag_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"flagged_by" uuid NOT NULL,
	"flagged_at" timestamp with time zone NOT NULL,
	"decision_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "fraud_flag_kind_ck" CHECK ("fraud_flag"."kind" in ('vault_gaming', 'quiz_collusion', 'referral_fraud')),
	CONSTRAINT "fraud_flag_state_ck" CHECK ("fraud_flag"."state" in ('open', 'cleared', 'banned')),
	CONSTRAINT "fraud_flag_decided_ck" CHECK (("fraud_flag"."state" = 'open') = ("fraud_flag"."decided_at" is null and "fraud_flag"."decision_reason" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fraud_flag_open_uq" ON "fraud_flag" USING btree ("user_id","kind") WHERE "fraud_flag"."state" = 'open';--> statement-breakpoint
CREATE INDEX "fraud_flag_state_idx" ON "fraud_flag" USING btree ("state","kind","flagged_at");--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."flag_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."kind" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."state" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."flagged_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."flagged_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."decision_reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."decided_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."decided_at" IS 'data-class C2 (Internal).';
