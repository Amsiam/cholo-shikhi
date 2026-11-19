CREATE TABLE "exam_package" (
	"exam_package_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title_bn" text NOT NULL,
	"title_en" text NOT NULL,
	"description_bn" text,
	"description_en" text,
	"list_price_poisha" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft_question_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"draft_time_limit_minutes" integer,
	"has_unpublished_changes" boolean DEFAULT false NOT NULL,
	"current_version_id" uuid,
	"first_published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"pin_rank" integer,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_package_status_ck" CHECK ("exam_package"."status" in ('draft', 'published', 'unpublished', 'retired')),
	CONSTRAINT "exam_package_price_ck" CHECK ("exam_package"."list_price_poisha" >= 1),
	CONSTRAINT "exam_package_time_limit_ck" CHECK ("exam_package"."draft_time_limit_minutes" is null or "exam_package"."draft_time_limit_minutes" between 1 and 600),
	CONSTRAINT "exam_package_questions_ck" CHECK (cardinality("exam_package"."draft_question_ids") <= 500),
	CONSTRAINT "exam_package_published_version_ck" CHECK ("exam_package"."status" = 'draft' or "exam_package"."current_version_id" is not null),
	CONSTRAINT "exam_package_title_len_ck" CHECK (char_length("exam_package"."title_bn") <= 150 and char_length("exam_package"."title_en") <= 150),
	CONSTRAINT "exam_package_pin_rank_ck" CHECK ("exam_package"."pin_rank" is null or "exam_package"."pin_rank" >= 1),
	CONSTRAINT "exam_package_version_ck" CHECK ("exam_package"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "exam_package_version" (
	"exam_package_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_package_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"question_ids" uuid[] NOT NULL,
	"time_limit_minutes" integer NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by" uuid NOT NULL,
	CONSTRAINT "exam_package_version_number_uq" UNIQUE("exam_package_id","version_number"),
	CONSTRAINT "exam_package_version_number_ck" CHECK ("exam_package_version"."version_number" >= 1),
	CONSTRAINT "exam_package_version_questions_ck" CHECK (cardinality("exam_package_version"."question_ids") between 1 and 500),
	CONSTRAINT "exam_package_version_time_ck" CHECK ("exam_package_version"."time_limit_minutes" between 1 and 600)
);
--> statement-breakpoint
CREATE TABLE "practice_pack" (
	"practice_pack_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title_bn" text NOT NULL,
	"title_en" text NOT NULL,
	"list_price_poisha" bigint NOT NULL,
	"question_set_ids" uuid[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"first_published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_pack_status_ck" CHECK ("practice_pack"."status" in ('draft', 'published', 'unpublished', 'retired')),
	CONSTRAINT "practice_pack_price_ck" CHECK ("practice_pack"."list_price_poisha" >= 1),
	CONSTRAINT "practice_pack_sets_ck" CHECK (cardinality("practice_pack"."question_set_ids") between 1 and 50),
	CONSTRAINT "practice_pack_title_len_ck" CHECK (char_length("practice_pack"."title_bn") <= 150 and char_length("practice_pack"."title_en") <= 150),
	CONSTRAINT "practice_pack_version_ck" CHECK ("practice_pack"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "subscription_plan" (
	"plan_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft_monthly_price_poisha" bigint,
	"draft_course_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"draft_exam_package_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"has_unpublished_changes" boolean DEFAULT false NOT NULL,
	"current_version_id" uuid,
	"first_published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"pin_rank" integer,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plan_status_ck" CHECK ("subscription_plan"."status" in ('draft', 'published', 'unpublished', 'retired')),
	CONSTRAINT "subscription_plan_price_ck" CHECK ("subscription_plan"."draft_monthly_price_poisha" is null or "subscription_plan"."draft_monthly_price_poisha" >= 1),
	CONSTRAINT "subscription_plan_published_version_ck" CHECK ("subscription_plan"."status" = 'draft' or "subscription_plan"."current_version_id" is not null),
	CONSTRAINT "subscription_plan_name_len_ck" CHECK (char_length("subscription_plan"."name_bn") <= 100 and char_length("subscription_plan"."name_en") <= 100),
	CONSTRAINT "subscription_plan_items_ck" CHECK (cardinality("subscription_plan"."draft_course_ids") + cardinality("subscription_plan"."draft_exam_package_ids") <= 500),
	CONSTRAINT "subscription_plan_pin_rank_ck" CHECK ("subscription_plan"."pin_rank" is null or "subscription_plan"."pin_rank" >= 1),
	CONSTRAINT "subscription_plan_version_ck" CHECK ("subscription_plan"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "subscription_plan_version" (
	"plan_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"monthly_price_poisha" bigint NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by" uuid NOT NULL,
	CONSTRAINT "subscription_plan_version_number_uq" UNIQUE("plan_id","version_number"),
	CONSTRAINT "subscription_plan_version_number_ck" CHECK ("subscription_plan_version"."version_number" >= 1),
	CONSTRAINT "subscription_plan_version_price_ck" CHECK ("subscription_plan_version"."monthly_price_poisha" >= 1)
);
--> statement-breakpoint
CREATE TABLE "subscription_plan_version_item" (
	"plan_version_item_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"course_id" uuid,
	"exam_package_id" uuid,
	CONSTRAINT "subscription_plan_version_item_course_uq" UNIQUE("plan_version_id","course_id"),
	CONSTRAINT "subscription_plan_version_item_exam_uq" UNIQUE("plan_version_id","exam_package_id"),
	CONSTRAINT "subscription_plan_version_item_ref_ck" CHECK (("subscription_plan_version_item"."item_type" = 'course' and "subscription_plan_version_item"."course_id" is not null and "subscription_plan_version_item"."exam_package_id" is null)
        or ("subscription_plan_version_item"."item_type" = 'exam_package' and "subscription_plan_version_item"."exam_package_id" is not null and "subscription_plan_version_item"."course_id" is null))
);
--> statement-breakpoint
ALTER TABLE "exam_package" ADD CONSTRAINT "exam_package_goal_id_goal_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("goal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_package" ADD CONSTRAINT "exam_package_current_version_id_exam_package_version_exam_package_version_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."exam_package_version"("exam_package_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_package_version" ADD CONSTRAINT "exam_package_version_exam_package_id_exam_package_exam_package_id_fk" FOREIGN KEY ("exam_package_id") REFERENCES "public"."exam_package"("exam_package_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_pack" ADD CONSTRAINT "practice_pack_course_id_course_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD CONSTRAINT "subscription_plan_goal_id_goal_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("goal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan" ADD CONSTRAINT "subscription_plan_current_version_id_subscription_plan_version_plan_version_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."subscription_plan_version"("plan_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_version" ADD CONSTRAINT "subscription_plan_version_plan_id_subscription_plan_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plan"("plan_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_version_item" ADD CONSTRAINT "subscription_plan_version_item_plan_version_id_subscription_plan_version_plan_version_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."subscription_plan_version"("plan_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_version_item" ADD CONSTRAINT "subscription_plan_version_item_course_id_course_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_version_item" ADD CONSTRAINT "subscription_plan_version_item_exam_package_id_exam_package_exam_package_id_fk" FOREIGN KEY ("exam_package_id") REFERENCES "public"."exam_package"("exam_package_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_package_published_goal_idx" ON "exam_package" USING btree ("goal_id","pin_rank","first_published_at" DESC NULLS LAST,"exam_package_id") WHERE "exam_package"."status" = 'published';--> statement-breakpoint
CREATE INDEX "exam_package_created_idx" ON "exam_package" USING btree ("created_at" DESC NULLS LAST,"exam_package_id");--> statement-breakpoint
CREATE INDEX "practice_pack_course_idx" ON "practice_pack" USING btree ("course_id","created_at","practice_pack_id");--> statement-breakpoint
CREATE INDEX "subscription_plan_published_goal_idx" ON "subscription_plan" USING btree ("goal_id","pin_rank","first_published_at" DESC NULLS LAST,"plan_id") WHERE "subscription_plan"."status" = 'published';--> statement-breakpoint
CREATE INDEX "subscription_plan_created_idx" ON "subscription_plan" USING btree ("created_at" DESC NULLS LAST,"plan_id");--> statement-breakpoint
CREATE INDEX "subscription_plan_version_item_course_idx" ON "subscription_plan_version_item" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "subscription_plan_version_item_exam_idx" ON "subscription_plan_version_item" USING btree ("exam_package_id");
--> statement-breakpoint
-- Hand-written below (NFR6.206, BR10.1, BR10.3, BR10.6), schema-agnostic like 0005.
-- BR10.3 / BR10.6 / NFR6.206: a published exam package or plan version is never changed or deleted.
-- The retention purge (SD-227) runs as the separate role catalog_retention, which needs the human's
-- approval (Step 50) and does not exist yet.
CREATE FUNCTION catalog_product_version_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'catalog_retention' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% rows are immutable (%)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER "exam_package_version_immutable" BEFORE UPDATE OR DELETE ON "exam_package_version" FOR EACH ROW EXECUTE FUNCTION catalog_product_version_refuse_change();
--> statement-breakpoint
CREATE TRIGGER "subscription_plan_version_immutable" BEFORE UPDATE OR DELETE ON "subscription_plan_version" FOR EACH ROW EXECUTE FUNCTION catalog_product_version_refuse_change();
--> statement-breakpoint
CREATE TRIGGER "subscription_plan_version_item_immutable" BEFORE UPDATE OR DELETE ON "subscription_plan_version_item" FOR EACH ROW EXECUTE FUNCTION catalog_product_version_refuse_change();
--> statement-breakpoint
-- BR10.1: a plan version holds only items of the plan's own Goal.
CREATE FUNCTION catalog_plan_item_same_goal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_goal uuid; item_goal uuid;
BEGIN
  SELECT p.goal_id INTO plan_goal FROM subscription_plan_version v
    JOIN subscription_plan p ON p.plan_id = v.plan_id WHERE v.plan_version_id = NEW.plan_version_id;
  IF NEW.item_type = 'course' THEN
    SELECT goal_id INTO item_goal FROM course WHERE course_id = NEW.course_id;
  ELSE
    SELECT goal_id INTO item_goal FROM exam_package WHERE exam_package_id = NEW.exam_package_id;
  END IF;
  IF item_goal IS DISTINCT FROM plan_goal THEN
    RAISE EXCEPTION 'plan items must be of the plan''s Goal' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "subscription_plan_version_item_goal" BEFORE INSERT ON "subscription_plan_version_item" FOR EACH ROW EXECUTE FUNCTION catalog_plan_item_same_goal();
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."exam_package_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."goal_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."title_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft.';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."title_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft.';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."description_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft.';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."description_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft.';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."list_price_poisha" IS 'data-class C1 (Public). Integer poisha.';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."status" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."draft_question_ids" IS 'data-class C2 (Internal). U4 Assessment IDs; not foreign keys (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."draft_time_limit_minutes" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."has_unpublished_changes" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."current_version_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."first_published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."unpublished_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."retired_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."pin_rank" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."created_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package"."updated_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package_version"."exam_package_version_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package_version"."exam_package_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package_version"."version_number" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package_version"."question_ids" IS 'data-class C2 (Internal). U4 Assessment IDs; not foreign keys (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package_version"."time_limit_minutes" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package_version"."published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "exam_package_version"."published_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."plan_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."goal_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."name_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."name_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."status" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."draft_monthly_price_poisha" IS 'data-class C2 (Internal). Integer poisha.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."draft_course_ids" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."draft_exam_package_ids" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."has_unpublished_changes" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."current_version_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."first_published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."unpublished_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."retired_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."pin_rank" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."created_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan"."updated_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version"."plan_version_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version"."plan_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version"."version_number" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version"."monthly_price_poisha" IS 'data-class C1 (Public). Integer poisha.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version"."published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version"."published_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version_item"."plan_version_item_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version_item"."plan_version_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version_item"."item_type" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version_item"."course_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_version_item"."exam_package_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."practice_pack_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."course_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."title_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft.';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."title_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft.';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."list_price_poisha" IS 'data-class C1 (Public). Integer poisha.';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."question_set_ids" IS 'data-class C2 (Internal). U4 Assessment IDs; not foreign keys (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."status" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."first_published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."unpublished_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."retired_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."created_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "practice_pack"."updated_at" IS 'data-class C2 (Internal).';
