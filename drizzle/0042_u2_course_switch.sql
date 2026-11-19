CREATE TABLE "course_switch_request" (
	"switch_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"from_course_id" uuid NOT NULL,
	"to_course_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"policy" text,
	"refund_poisha" integer,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "course_switch_status_ck" CHECK ("course_switch_request"."status" in ('pending', 'approved', 'denied', 'expired')),
	CONSTRAINT "course_switch_courses_ck" CHECK ("course_switch_request"."from_course_id" <> "course_switch_request"."to_course_id"),
	CONSTRAINT "course_switch_deadline_ck" CHECK ("course_switch_request"."deadline_at" > "course_switch_request"."requested_at"),
	CONSTRAINT "course_switch_approved_ck" CHECK (("course_switch_request"."status" = 'approved') = ("course_switch_request"."refund_poisha" is not null and "course_switch_request"."policy" is not null)),
	CONSTRAINT "course_switch_refund_ck" CHECK ("course_switch_request"."refund_poisha" is null or "course_switch_request"."refund_poisha" >= 0)
);
--> statement-breakpoint
ALTER TABLE "enrolment" DROP CONSTRAINT "enrolment_status_ck";--> statement-breakpoint
CREATE UNIQUE INDEX "course_switch_one_pending_uq" ON "course_switch_request" USING btree ("user_id") WHERE "course_switch_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "course_switch_queue_idx" ON "course_switch_request" USING btree ("status","deadline_at");--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_status_ck" CHECK ("enrolment"."status" in ('active', 'expired', 'revoked', 'switched'));--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."switch_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."enrolment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."payment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."from_course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."to_course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."requested_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."deadline_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."policy" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."refund_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."reason" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."decided_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "course_switch_request"."decided_at" IS 'data-class C2 (Internal).';