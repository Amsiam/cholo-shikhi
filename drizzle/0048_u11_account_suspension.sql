CREATE TABLE "account_suspension" (
	"suspension_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"suspended_by" uuid NOT NULL,
	"suspended_at" timestamp with time zone NOT NULL,
	"reinstate_reason" text,
	"reinstated_by" uuid,
	"reinstated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fraud_flag" DROP CONSTRAINT "fraud_flag_state_ck";--> statement-breakpoint
ALTER TABLE "fraud_flag" ADD COLUMN "reinstate_reason" text;--> statement-breakpoint
ALTER TABLE "fraud_flag" ADD COLUMN "reinstated_by" uuid;--> statement-breakpoint
ALTER TABLE "fraud_flag" ADD COLUMN "reinstated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_suspension" ADD CONSTRAINT "account_suspension_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_suspension_active_uq" ON "account_suspension" USING btree ("user_id") WHERE "account_suspension"."reinstated_at" is null;--> statement-breakpoint
CREATE INDEX "account_suspension_user_idx" ON "account_suspension" USING btree ("user_id","suspended_at");--> statement-breakpoint
ALTER TABLE "fraud_flag" ADD CONSTRAINT "fraud_flag_state_ck" CHECK ("fraud_flag"."state" in ('open', 'cleared', 'banned', 'reinstated'));--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."suspension_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."source" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."suspended_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."suspended_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."reinstate_reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."reinstated_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "account_suspension"."reinstated_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."reinstate_reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."reinstated_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "fraud_flag"."reinstated_at" IS 'data-class C2 (Internal).';
