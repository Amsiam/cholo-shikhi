CREATE TABLE "exam" (
	"exam_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title_bn" text NOT NULL,
	"title_en" text NOT NULL,
	"goal_id" uuid,
	"duration_minutes" integer NOT NULL,
	"negative_bps" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"blueprint" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"question_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_kind_ck" CHECK ("exam"."kind" in ('mock', 'live', 'custom')),
	CONSTRAINT "exam_status_ck" CHECK ("exam"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "exam_title_ck" CHECK (char_length("exam"."title_bn") between 1 and 150 and char_length("exam"."title_en") between 1 and 150),
	CONSTRAINT "exam_duration_ck" CHECK ("exam"."duration_minutes" between 1 and 300),
	CONSTRAINT "exam_negative_ck" CHECK ("exam"."negative_bps" between 0 and 10000),
	CONSTRAINT "exam_questions_ck" CHECK (cardinality("exam"."question_ids") <= 200),
	CONSTRAINT "exam_live_start_ck" CHECK ("exam"."kind" <> 'live' or "exam"."starts_at" is not null),
	CONSTRAINT "exam_goal_ck" CHECK ("exam"."kind" = 'custom' or "exam"."goal_id" is not null),
	CONSTRAINT "exam_published_ck" CHECK ("exam"."status" = 'draft' or cardinality("exam"."question_ids") >= 1)
);
--> statement-breakpoint
CREATE TABLE "exam_attempt" (
	"attempt_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correct_count" integer,
	"wrong_count" integer,
	"skipped_count" integer,
	"score_x100" integer,
	"max_x100" integer,
	CONSTRAINT "exam_attempt_deadline_ck" CHECK ("exam_attempt"."deadline_at" > "exam_attempt"."started_at")
);
--> statement-breakpoint
ALTER TABLE "exam_attempt" ADD CONSTRAINT "exam_attempt_exam_id_exam_exam_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exam"("exam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_goal_idx" ON "exam" USING btree ("goal_id","status","kind");--> statement-breakpoint
CREATE INDEX "exam_creator_idx" ON "exam" USING btree ("created_by","updated_at");--> statement-breakpoint
CREATE INDEX "exam_attempt_user_idx" ON "exam_attempt" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "exam_attempt_exam_idx" ON "exam_attempt" USING btree ("exam_id","score_x100");--> statement-breakpoint
COMMENT ON COLUMN "exam"."exam_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."kind" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."title_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."title_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."goal_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."duration_minutes" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."negative_bps" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."starts_at" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."blueprint" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."question_ids" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."created_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."published_at" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."version" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."updated_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."attempt_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."exam_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."started_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."deadline_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."submitted_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."answers" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."correct_count" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."wrong_count" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."skipped_count" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."score_x100" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."max_x100" IS 'data-class C3 (Personal).';
