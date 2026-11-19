CREATE TABLE "bank_answer" (
	"bank_answer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"chosen_index" integer NOT NULL,
	"is_correct" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_answer_once_uq" UNIQUE("bank_answer_id"),
	CONSTRAINT "bank_answer_choice_ck" CHECK ("bank_answer"."chosen_index" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "bank_question" (
	"question_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"difficulty" text NOT NULL,
	"prompt_bn" text NOT NULL,
	"prompt_en" text NOT NULL,
	"options_bn" text[] NOT NULL,
	"options_en" text[] NOT NULL,
	"correct_index" integer NOT NULL,
	"explanation_bn" text,
	"explanation_en" text,
	"source_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"author_id" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_question_options_ck" CHECK (cardinality("bank_question"."options_bn") = 4 and cardinality("bank_question"."options_en") = 4),
	CONSTRAINT "bank_question_correct_ck" CHECK ("bank_question"."correct_index" between 0 and 3),
	CONSTRAINT "bank_question_len_ck" CHECK (char_length("bank_question"."prompt_bn") <= 1000 and char_length("bank_question"."prompt_en") <= 1000),
	CONSTRAINT "bank_question_source_ck" CHECK ("bank_question"."source_note" is null or char_length("bank_question"."source_note") <= 120),
	CONSTRAINT "bank_question_status_ck" CHECK ("bank_question"."status" in ('draft', 'in_review', 'published', 'rejected', 'retired')),
	CONSTRAINT "bank_question_difficulty_ck" CHECK ("bank_question"."difficulty" in ('easy', 'medium', 'hard'))
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"subject_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_name_ck" CHECK (char_length("subject"."name_bn") between 1 and 80 and char_length("subject"."name_en") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "subject_goal" (
	"subject_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	CONSTRAINT "subject_goal_subject_id_goal_id_pk" PRIMARY KEY("subject_id","goal_id")
);
--> statement-breakpoint
CREATE TABLE "topic" (
	"topic_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"parent_topic_id" uuid,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_name_ck" CHECK (char_length("topic"."name_bn") between 1 and 120 and char_length("topic"."name_en") between 1 and 120),
	CONSTRAINT "topic_not_own_parent_ck" CHECK ("topic"."parent_topic_id" is null or "topic"."parent_topic_id" <> "topic"."topic_id")
);
--> statement-breakpoint
ALTER TABLE "vault_answer" DROP CONSTRAINT "vault_answer_question_id_quiz_question_question_id_fk";
--> statement-breakpoint
ALTER TABLE "vault_item" DROP CONSTRAINT "vault_item_question_id_quiz_question_question_id_fk";
--> statement-breakpoint
ALTER TABLE "vault_item" ALTER COLUMN "lesson_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_item" ALTER COLUMN "course_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_item" ADD COLUMN "source" text DEFAULT 'lesson' NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_item" ADD COLUMN "topic_id" uuid;--> statement-breakpoint
ALTER TABLE "vault_item" ADD COLUMN "difficulty" text;--> statement-breakpoint
ALTER TABLE "bank_answer" ADD CONSTRAINT "bank_answer_question_id_bank_question_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."bank_question"("question_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_topic_id_topic_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("topic_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_goal" ADD CONSTRAINT "subject_goal_subject_id_subject_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_subject_id_subject_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_parent_topic_id_topic_topic_id_fk" FOREIGN KEY ("parent_topic_id") REFERENCES "public"."topic"("topic_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_answer_user_idx" ON "bank_answer" USING btree ("user_id","answered_at");--> statement-breakpoint
CREATE INDEX "bank_question_topic_idx" ON "bank_question" USING btree ("topic_id","status","difficulty");--> statement-breakpoint
CREATE INDEX "bank_question_author_idx" ON "bank_question" USING btree ("author_id","updated_at");--> statement-breakpoint
CREATE INDEX "bank_question_review_idx" ON "bank_question" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "subject_goal_goal_idx" ON "subject_goal" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "topic_subject_idx" ON "topic" USING btree ("subject_id","parent_topic_id","sort_order");--> statement-breakpoint
ALTER TABLE "vault_item" ADD CONSTRAINT "vault_item_source_ck" CHECK ("vault_item"."source" in ('lesson', 'bank'));--> statement-breakpoint
ALTER TABLE "vault_item" ADD CONSTRAINT "vault_item_lesson_ref_ck" CHECK ("vault_item"."source" <> 'lesson' or ("vault_item"."lesson_id" is not null and "vault_item"."course_id" is not null));--> statement-breakpoint
COMMENT ON COLUMN "subject"."subject_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "subject"."name_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "subject"."name_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "subject"."sort_order" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "subject"."is_active" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "subject"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "subject_goal"."subject_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "subject_goal"."goal_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "topic"."topic_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "topic"."subject_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "topic"."parent_topic_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "topic"."name_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "topic"."name_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "topic"."sort_order" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "topic"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."question_id" IS 'data-class C1 (Public) once published; C2 (Internal) otherwise.';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."topic_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."difficulty" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."prompt_bn" IS 'data-class C1 (Public) once published; C2 (Internal) otherwise.';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."prompt_en" IS 'data-class C1 (Public) once published; C2 (Internal) otherwise.';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."options_bn" IS 'data-class C1 (Public) once published; C2 (Internal) otherwise.';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."options_en" IS 'data-class C1 (Public) once published; C2 (Internal) otherwise.';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."correct_index" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."explanation_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."explanation_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."source_note" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."author_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."reviewed_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."reviewed_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."review_note" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."version" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."updated_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_answer"."bank_answer_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_answer"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_answer"."question_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_answer"."chosen_index" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_answer"."is_correct" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_answer"."answered_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."source" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."topic_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "vault_item"."difficulty" IS 'data-class C2 (Internal).';
