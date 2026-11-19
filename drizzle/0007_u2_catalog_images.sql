CREATE TABLE "catalog_image" (
	"image_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"variant_widths" integer[] NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"desired_state" text DEFAULT 'active' NOT NULL,
	"actual_state" text DEFAULT 'active' NOT NULL,
	"desired_since" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "catalog_image_storage_key_uq" UNIQUE("storage_key"),
	CONSTRAINT "catalog_image_kind_ck" CHECK ("catalog_image"."kind" in ('cover', 'inline')),
	CONSTRAINT "catalog_image_desired_ck" CHECK ("catalog_image"."desired_state" in ('active', 'quarantined', 'deleted')),
	CONSTRAINT "catalog_image_actual_ck" CHECK ("catalog_image"."actual_state" in ('active', 'quarantined', 'deleted')),
	CONSTRAINT "catalog_image_key_ck" CHECK ("catalog_image"."storage_key" ~ '^img/[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "catalog_image_size_ck" CHECK ("catalog_image"."width" between 1 and 1600 and "catalog_image"."height" >= 1),
	CONSTRAINT "catalog_image_widths_ck" CHECK (cardinality("catalog_image"."variant_widths") between 1 and 3),
	CONSTRAINT "catalog_image_version_ck" CHECK ("catalog_image"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lesson_version_image" (
	"lesson_version_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	CONSTRAINT "lesson_version_image_pk" PRIMARY KEY("lesson_version_id","image_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_image" ADD CONSTRAINT "catalog_image_course_id_course_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_version_image" ADD CONSTRAINT "lesson_version_image_lesson_version_id_lesson_version_lesson_version_id_fk" FOREIGN KEY ("lesson_version_id") REFERENCES "public"."lesson_version"("lesson_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_version_image" ADD CONSTRAINT "lesson_version_image_image_id_catalog_image_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."catalog_image"("image_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_image_course_idx" ON "catalog_image" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_image_pending_idx" ON "catalog_image" USING btree ("desired_since") WHERE "catalog_image"."desired_state" <> "catalog_image"."actual_state";--> statement-breakpoint
CREATE INDEX "lesson_version_image_image_idx" ON "lesson_version_image" USING btree ("image_id");--> statement-breakpoint
-- Hand-written below (NFR5.201 / SD-224): every column carries its data class.
COMMENT ON COLUMN "catalog_image"."image_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."course_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."kind" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."storage_key" IS 'data-class C1 (Public). 128 random bits (SD-217), unrelated to course, user or file name.';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."variant_widths" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."width" IS 'data-class C1 (Public). Decoded output size only.';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."height" IS 'data-class C1 (Public). Decoded output size only.';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."desired_state" IS 'data-class C2 (Internal). Recomputed from the database (SD-220).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."actual_state" IS 'data-class C2 (Internal). Where the objects are (RD-211).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."desired_since" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."uploaded_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "catalog_image"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version_image"."lesson_version_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version_image"."image_id" IS 'data-class C2 (Internal).';
