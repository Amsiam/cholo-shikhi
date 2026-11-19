CREATE TABLE "enrolment" (
	"enrolment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrolment_payment_uq" UNIQUE("payment_id"),
	CONSTRAINT "enrolment_window_ck" CHECK ("enrolment"."ends_at" > "enrolment"."starts_at"),
	CONSTRAINT "enrolment_status_ck" CHECK ("enrolment"."status" in ('active', 'expired', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_progress_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"payment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"access_duration_months" integer NOT NULL,
	"gateway" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"gateway_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "payment_amount_ck" CHECK ("payment"."amount_poisha" >= 1),
	CONSTRAINT "payment_currency_ck" CHECK ("payment"."currency" = 'BDT'),
	CONSTRAINT "payment_months_ck" CHECK ("payment"."access_duration_months" in (4, 6, 12)),
	CONSTRAINT "payment_status_ck" CHECK ("payment"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "payment_settled_ck" CHECK (("payment"."status" = 'pending') = ("payment"."settled_at" is null))
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt" (
	"attempt_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"total" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_attempt_score_ck" CHECK ("quiz_attempt"."score" >= 0 and "quiz_attempt"."score" <= "quiz_attempt"."total")
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt_answer" (
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"chosen_index" integer,
	"is_correct" boolean NOT NULL,
	CONSTRAINT "quiz_attempt_answer_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id"),
	CONSTRAINT "quiz_attempt_answer_choice_ck" CHECK ("quiz_attempt_answer"."chosen_index" is null or "quiz_attempt_answer"."chosen_index" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "quiz_question" (
	"question_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"prompt_bn" text NOT NULL,
	"prompt_en" text NOT NULL,
	"options_bn" text[] NOT NULL,
	"options_en" text[] NOT NULL,
	"correct_index" integer NOT NULL,
	"explanation_bn" text,
	"explanation_en" text,
	CONSTRAINT "quiz_question_position_uq" UNIQUE("lesson_id","position"),
	CONSTRAINT "quiz_question_position_ck" CHECK ("quiz_question"."position" >= 1),
	CONSTRAINT "quiz_question_options_ck" CHECK (cardinality("quiz_question"."options_bn") = 4 and cardinality("quiz_question"."options_en") = 4),
	CONSTRAINT "quiz_question_correct_ck" CHECK ("quiz_question"."correct_index" between 0 and 3),
	CONSTRAINT "quiz_question_len_ck" CHECK (char_length("quiz_question"."prompt_bn") <= 1000 and char_length("quiz_question"."prompt_en") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "lesson_version" ADD COLUMN "youtube_video_id" text;--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_payment_id_payment_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("payment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt_answer" ADD CONSTRAINT "quiz_attempt_answer_attempt_id_quiz_attempt_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempt"("attempt_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrolment_active_uq" ON "enrolment" USING btree ("user_id","course_id") WHERE "enrolment"."status" = 'active';--> statement-breakpoint
CREATE INDEX "enrolment_user_idx" ON "enrolment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lesson_progress_course_idx" ON "lesson_progress" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE INDEX "payment_user_idx" ON "payment" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "quiz_attempt_user_lesson_idx" ON "quiz_attempt" USING btree ("user_id","lesson_id","submitted_at");--> statement-breakpoint
ALTER TABLE "lesson_version" ADD CONSTRAINT "lesson_version_youtube_id_ck" CHECK ("lesson_version"."youtube_video_id" is null or "lesson_version"."youtube_video_id" ~ '^[A-Za-z0-9_-]{11}$');