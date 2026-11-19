CREATE TABLE "takedown_notice" (
	"notice_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" text NOT NULL,
	"content_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"claimant" text NOT NULL,
	"claimant_contact" text NOT NULL,
	"claim" text NOT NULL,
	"evidence" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"decision_reason" text,
	"reversal_reason" text,
	"logged_by" uuid NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "takedown_notice_state_ck" CHECK ("takedown_notice"."state" in ('open', 'honoured', 'rejected', 'reversed')),
	CONSTRAINT "takedown_notice_type_ck" CHECK ("takedown_notice"."content_type" in ('course', 'section', 'lesson')),
	CONSTRAINT "takedown_notice_decided_ck" CHECK (("takedown_notice"."state" = 'open') = ("takedown_notice"."decision_reason" is null)),
	CONSTRAINT "takedown_notice_reversed_ck" CHECK (("takedown_notice"."state" = 'reversed') = ("takedown_notice"."reversal_reason" is not null))
);
--> statement-breakpoint
CREATE INDEX "takedown_notice_state_idx" ON "takedown_notice" USING btree ("state","logged_at");--> statement-breakpoint
CREATE INDEX "takedown_notice_course_idx" ON "takedown_notice" USING btree ("course_id");--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."notice_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."content_type" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."content_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."claimant" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."claimant_contact" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."claim" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."evidence" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."state" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."decision_reason" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."reversal_reason" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."logged_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."logged_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."decided_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."decided_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."reversed_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "takedown_notice"."reversed_at" IS 'data-class C2 (Internal).';