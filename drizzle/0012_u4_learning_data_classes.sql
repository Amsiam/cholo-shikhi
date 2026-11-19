-- Data class per column (NFR5.201) for the youtube_video_id column (0010) and the commerce and
-- learning tables. C1 public, C2 internal, C3 personal: the same classes as src/server/schema/learning.ts.
COMMENT ON COLUMN "lesson_version"."youtube_video_id" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."payment_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."user_id" IS 'data-class C3 (Personal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."course_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."amount_poisha" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."currency" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."access_duration_months" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."gateway" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."status" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."gateway_ref" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "payment"."settled_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "enrolment"."enrolment_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "enrolment"."user_id" IS 'data-class C3 (Personal).';
--> statement-breakpoint
COMMENT ON COLUMN "enrolment"."course_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "enrolment"."payment_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "enrolment"."starts_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "enrolment"."ends_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "enrolment"."status" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "enrolment"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_progress"."user_id" IS 'data-class C3 (Personal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_progress"."lesson_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_progress"."course_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_progress"."completed_at" IS 'data-class C3 (Personal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."question_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."lesson_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."position" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."prompt_bn" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."prompt_en" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."options_bn" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."options_en" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."correct_index" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."explanation_bn" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."explanation_en" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt"."attempt_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt"."user_id" IS 'data-class C3 (Personal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt"."lesson_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt"."course_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt"."score" IS 'data-class C3 (Personal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt"."total" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt"."submitted_at" IS 'data-class C3 (Personal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt_answer"."attempt_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt_answer"."question_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt_answer"."chosen_index" IS 'data-class C3 (Personal).';
--> statement-breakpoint
COMMENT ON COLUMN "quiz_attempt_answer"."is_correct" IS 'data-class C3 (Personal).';
