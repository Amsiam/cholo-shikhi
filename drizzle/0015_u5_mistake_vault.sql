CREATE TABLE "vault_answer" (
	"vault_answer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"chosen_index" integer NOT NULL,
	"is_correct" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_answer_choice_ck" CHECK ("vault_answer"."chosen_index" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "vault_item" (
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"goal_id" uuid,
	"last_wrong_choice" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"correct_run" integer DEFAULT 0 NOT NULL,
	"wrong_count" integer DEFAULT 1 NOT NULL,
	"first_wrong_at" timestamp with time zone NOT NULL,
	"last_wrong_at" timestamp with time zone NOT NULL,
	"last_practised_at" timestamp with time zone,
	"mastered_at" timestamp with time zone,
	CONSTRAINT "vault_item_user_id_question_id_pk" PRIMARY KEY("user_id","question_id"),
	CONSTRAINT "vault_item_status_ck" CHECK ("vault_item"."status" in ('active', 'mastered')),
	CONSTRAINT "vault_item_run_ck" CHECK ("vault_item"."correct_run" >= 0 and "vault_item"."wrong_count" >= 1),
	CONSTRAINT "vault_item_mastered_ck" CHECK (("vault_item"."status" = 'mastered') = ("vault_item"."mastered_at" is not null)),
	CONSTRAINT "vault_item_choice_ck" CHECK ("vault_item"."last_wrong_choice" is null or "vault_item"."last_wrong_choice" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "vault_answer" ADD CONSTRAINT "vault_answer_question_id_quiz_question_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_question"("question_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_item" ADD CONSTRAINT "vault_item_question_id_quiz_question_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_question"("question_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_answer_user_idx" ON "vault_answer" USING btree ("user_id","answered_at");--> statement-breakpoint
CREATE INDEX "vault_item_queue_idx" ON "vault_item" USING btree ("user_id","status","goal_id");--> statement-breakpoint
-- Backfill: every wrong answer already given in a quiz becomes a vault item (one per Student and
-- question), with the course's Goal and the latest wrong choice.
INSERT INTO "vault_item" (user_id, question_id, lesson_id, course_id, goal_id, last_wrong_choice,
                          status, correct_run, wrong_count, first_wrong_at, last_wrong_at)
SELECT a.user_id, x.question_id, a.lesson_id, a.course_id, c.goal_id,
       (array_agg(x.chosen_index ORDER BY a.submitted_at DESC))[1],
       'active', 0, count(*), min(a.submitted_at), max(a.submitted_at)
  FROM quiz_attempt_answer x
  JOIN quiz_attempt a ON a.attempt_id = x.attempt_id
  JOIN quiz_question q ON q.question_id = x.question_id
  LEFT JOIN course c ON c.course_id = a.course_id
 WHERE NOT x.is_correct
 GROUP BY a.user_id, x.question_id, a.lesson_id, a.course_id, c.goal_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."question_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."lesson_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."goal_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."last_wrong_choice" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."status" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."correct_run" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."wrong_count" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."first_wrong_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."last_wrong_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."last_practised_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."mastered_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_answer"."vault_answer_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_answer"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_answer"."question_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_answer"."chosen_index" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_answer"."is_correct" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_answer"."answered_at" IS 'data-class C3 (Personal).';
