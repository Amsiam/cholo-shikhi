ALTER TABLE "course_trial" ADD COLUMN "lesson_cap" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "course_trial" ADD CONSTRAINT "course_trial_lesson_cap_ck" CHECK ("course_trial"."lesson_cap" >= 1);--> statement-breakpoint
COMMENT ON COLUMN "course_trial"."lesson_cap" IS 'data-class C2 (Internal).';