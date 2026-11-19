DROP INDEX "bank_question_topic_idx";--> statement-breakpoint
ALTER TABLE "bank_question" ADD COLUMN "effective_difficulty" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_question" ADD COLUMN "first_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_question" ADD COLUMN "first_correct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "bank_answer_user_question_idx" ON "bank_answer" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "bank_question_topic_idx" ON "bank_question" USING btree ("topic_id","status","effective_difficulty");--> statement-breakpoint
ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_attempts_ck" CHECK ("bank_question"."first_correct" between 0 and "bank_question"."first_attempts");--> statement-breakpoint
ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_effective_ck" CHECK ("bank_question"."effective_difficulty" in ('easy', 'medium', 'hard'));--> statement-breakpoint
UPDATE "bank_question" SET "effective_difficulty" = "difficulty";--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."effective_difficulty" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."first_attempts" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."first_correct" IS 'data-class C2 (Internal).';
