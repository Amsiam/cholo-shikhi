CREATE TABLE "goal" (
	"goal_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_status_ck" CHECK ("goal"."status" in ('inactive', 'active', 'retired')),
	CONSTRAINT "goal_retired_at_ck" CHECK (("goal"."status" = 'retired') = ("goal"."retired_at" is not null)),
	CONSTRAINT "goal_sort_order_ck" CHECK ("goal"."sort_order" >= 0),
	CONSTRAINT "goal_version_ck" CHECK ("goal"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "goal_segment" (
	"segment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"segment_type" text NOT NULL,
	"battle_band" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_segment_type_ck" CHECK ("goal_segment"."segment_type" in ('academic', 'job_aspirant')),
	CONSTRAINT "goal_segment_battle_band_ck" CHECK ("goal_segment"."battle_band" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "goal_segment_sort_order_ck" CHECK ("goal_segment"."sort_order" >= 0),
	CONSTRAINT "goal_segment_version_ck" CHECK ("goal_segment"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "student_goal_selection" (
	"goal_selection_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"selected_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "student_goal_selection_end_ck" CHECK (("student_goal_selection"."ended_at" is null) = ("student_goal_selection"."end_reason" is null)),
	CONSTRAINT "student_goal_selection_end_reason_ck" CHECK ("student_goal_selection"."end_reason" is null or "student_goal_selection"."end_reason" = 'changed')
);
--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_segment_id_goal_segment_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."goal_segment"("segment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_goal_selection" ADD CONSTRAINT "student_goal_selection_goal_id_goal_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("goal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_goal_selection" ADD CONSTRAINT "student_goal_selection_segment_id_goal_segment_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."goal_segment"("segment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_name_bn_uq" ON "goal" USING btree ("segment_id",lower(btrim("name_bn")));--> statement-breakpoint
CREATE UNIQUE INDEX "goal_name_en_uq" ON "goal" USING btree ("segment_id",lower(btrim("name_en")));--> statement-breakpoint
CREATE INDEX "goal_status_idx" ON "goal" USING btree ("status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_segment_name_bn_uq" ON "goal_segment" USING btree (lower(btrim("name_bn")));--> statement-breakpoint
CREATE UNIQUE INDEX "goal_segment_name_en_uq" ON "goal_segment" USING btree (lower(btrim("name_en")));--> statement-breakpoint
CREATE UNIQUE INDEX "student_goal_selection_open_uq" ON "student_goal_selection" USING btree ("user_id") WHERE "student_goal_selection"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "student_goal_selection_user_idx" ON "student_goal_selection" USING btree ("user_id","selected_at");--> statement-breakpoint
CREATE INDEX "student_goal_selection_goal_idx" ON "student_goal_selection" USING btree ("goal_id");--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."segment_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."name_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."name_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."segment_type" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."battle_band" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."sort_order" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."version" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "goal_segment"."updated_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."goal_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."segment_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."name_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."name_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."status" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."sort_order" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."retired_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."version" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "goal"."updated_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "student_goal_selection"."goal_selection_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "student_goal_selection"."user_id" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';--> statement-breakpoint
COMMENT ON COLUMN "student_goal_selection"."goal_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "student_goal_selection"."segment_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "student_goal_selection"."selected_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "student_goal_selection"."ended_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "student_goal_selection"."end_reason" IS 'data-class C3 (Personal).';
