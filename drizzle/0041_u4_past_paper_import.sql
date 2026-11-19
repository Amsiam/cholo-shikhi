ALTER TABLE "bank_question" ADD COLUMN "is_past_paper" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_question" ADD COLUMN "rights_status" text;--> statement-breakpoint
ALTER TABLE "bank_question" ADD COLUMN "import_key" text;--> statement-breakpoint
ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_import_key_unique" UNIQUE("import_key");--> statement-breakpoint
ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_past_paper_ck" CHECK ("bank_question"."is_past_paper" = ("bank_question"."rights_status" is not null) and ("bank_question"."rights_status" is null or "bank_question"."rights_status" in ('public_domain', 'rights_cleared')));--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."is_past_paper" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."rights_status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bank_question"."import_key" IS 'data-class C2 (Internal).';