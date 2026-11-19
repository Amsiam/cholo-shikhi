CREATE TABLE "live_attendance" (
	"live_class_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"first_join_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "live_attendance_live_class_id_user_id_pk" PRIMARY KEY("live_class_id","user_id"),
	CONSTRAINT "live_attendance_active_ck" CHECK ("live_attendance"."active_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "live_class" (
	"live_class_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title_bn" text NOT NULL,
	"title_en" text NOT NULL,
	"youtube_video_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"keeps_recording" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_class_title_ck" CHECK (char_length("live_class"."title_bn") between 1 and 150 and char_length("live_class"."title_en") between 1 and 150),
	CONSTRAINT "live_class_video_ck" CHECK ("live_class"."youtube_video_id" ~ '^[A-Za-z0-9_-]{11}$'),
	CONSTRAINT "live_class_duration_ck" CHECK ("live_class"."duration_minutes" between 10 and 300)
);
--> statement-breakpoint
CREATE TABLE "live_quiz" (
	"quiz_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"live_class_id" uuid NOT NULL,
	"question_ids" uuid[] NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_by" uuid NOT NULL,
	CONSTRAINT "live_quiz_count_ck" CHECK (cardinality("live_quiz"."question_ids") between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "live_quiz_answer" (
	"quiz_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"chosen_index" integer NOT NULL,
	"is_correct" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_quiz_answer_quiz_id_user_id_question_id_pk" PRIMARY KEY("quiz_id","user_id","question_id"),
	CONSTRAINT "live_quiz_answer_choice_ck" CHECK ("live_quiz_answer"."chosen_index" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "live_attendance" ADD CONSTRAINT "live_attendance_live_class_id_live_class_live_class_id_fk" FOREIGN KEY ("live_class_id") REFERENCES "public"."live_class"("live_class_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_quiz" ADD CONSTRAINT "live_quiz_live_class_id_live_class_live_class_id_fk" FOREIGN KEY ("live_class_id") REFERENCES "public"."live_class"("live_class_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_quiz_answer" ADD CONSTRAINT "live_quiz_answer_quiz_id_live_quiz_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."live_quiz"("quiz_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_class_course_idx" ON "live_class" USING btree ("course_id","starts_at");--> statement-breakpoint
CREATE INDEX "live_class_starts_idx" ON "live_class" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "live_quiz_class_idx" ON "live_quiz" USING btree ("live_class_id","started_at");--> statement-breakpoint
COMMENT ON COLUMN "live_class"."live_class_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."course_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."title_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."title_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."youtube_video_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."starts_at" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."duration_minutes" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."is_cancelled" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."keeps_recording" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."created_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_class"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "live_attendance"."live_class_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "live_attendance"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_attendance"."first_join_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_attendance"."last_seen_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_attendance"."active_seconds" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz"."quiz_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz"."live_class_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz"."question_ids" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz"."started_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz"."started_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz_answer"."quiz_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz_answer"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz_answer"."question_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz_answer"."chosen_index" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz_answer"."is_correct" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz_answer"."answered_at" IS 'data-class C3 (Personal).';
