CREATE TABLE "course_trial" (
	"user_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "course_trial_user_id_segment_id_pk" PRIMARY KEY("user_id","segment_id"),
	CONSTRAINT "course_trial_window_ck" CHECK ("course_trial"."ends_at" > "course_trial"."started_at")
);
--> statement-breakpoint
CREATE TABLE "trial_offer" (
	"segment_id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_offer_course_uq" UNIQUE("course_id")
);
--> statement-breakpoint
CREATE INDEX "course_trial_user_course_idx" ON "course_trial" USING btree ("user_id","course_id");--> statement-breakpoint
COMMENT ON COLUMN "trial_offer"."segment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "trial_offer"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "trial_offer"."set_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "trial_offer"."set_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_trial"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "course_trial"."segment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_trial"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_trial"."started_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "course_trial"."ends_at" IS 'data-class C3 (Personal).';
