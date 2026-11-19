CREATE TABLE "bundle" (
	"bundle_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"segment_id" uuid NOT NULL,
	"price_poisha" bigint NOT NULL,
	"course_ids" uuid[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundle_price_ck" CHECK ("bundle"."price_poisha" >= 1),
	CONSTRAINT "bundle_courses_ck" CHECK (cardinality("bundle"."course_ids") >= 2)
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"campaign_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"banner_bn" text NOT NULL,
	"banner_en" text NOT NULL,
	"landing_path" text NOT NULL,
	"segment_ids" uuid[] NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_dates_ck" CHECK ("campaign"."ends_on" >= "campaign"."starts_on"),
	CONSTRAINT "campaign_landing_ck" CHECK ("campaign"."landing_path" ~ '^/[^/]'),
	CONSTRAINT "campaign_segments_ck" CHECK (cardinality("campaign"."segment_ids") >= 1)
);
--> statement-breakpoint
CREATE TABLE "promo_code" (
	"promo_code_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"percent_bps" integer,
	"fixed_poisha" bigint,
	"course_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"segment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"max_uses" integer NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_code_code_uq" UNIQUE("code"),
	CONSTRAINT "promo_code_code_ck" CHECK ("promo_code"."code" ~ '^[A-Z0-9_-]{3,40}$'),
	CONSTRAINT "promo_code_kind_ck" CHECK ("promo_code"."kind" in ('percent', 'fixed')),
	CONSTRAINT "promo_code_value_ck" CHECK (("promo_code"."kind" = 'percent' and "promo_code"."percent_bps" between 1 and 10000 and "promo_code"."fixed_poisha" is null) or ("promo_code"."kind" = 'fixed' and "promo_code"."fixed_poisha" >= 1 and "promo_code"."percent_bps" is null)),
	CONSTRAINT "promo_code_dates_ck" CHECK ("promo_code"."ends_on" >= "promo_code"."starts_on"),
	CONSTRAINT "promo_code_uses_ck" CHECK ("promo_code"."max_uses" >= 1 and "promo_code"."used_count" between 0 and "promo_code"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "promo_redemption" (
	"redemption_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"list_price_poisha" bigint NOT NULL,
	"discount_poisha" bigint NOT NULL,
	"is_released" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_redemption_payment_uq" UNIQUE("payment_id"),
	CONSTRAINT "promo_redemption_amounts_ck" CHECK ("promo_redemption"."discount_poisha" >= 1 and "promo_redemption"."discount_poisha" < "promo_redemption"."list_price_poisha")
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "discount_poisha" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "promo_redemption" ADD CONSTRAINT "promo_redemption_promo_code_id_promo_code_promo_code_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_code"("promo_code_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bundle_segment_idx" ON "bundle" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "campaign_dates_idx" ON "campaign" USING btree ("ends_on","starts_on");--> statement-breakpoint
CREATE INDEX "promo_redemption_code_idx" ON "promo_redemption" USING btree ("promo_code_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_discount_ck" CHECK ("payment"."discount_poisha" >= 0 and ("payment"."discount_poisha" = 0) = ("payment"."promo_code_id" is null));--> statement-breakpoint
COMMENT ON COLUMN "campaign"."campaign_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."name_bn" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."name_en" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."banner_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."banner_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."landing_path" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."segment_ids" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."starts_on" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."ends_on" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."created_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "campaign"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."promo_code_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."code" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."kind" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."percent_bps" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."fixed_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."course_ids" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."segment_ids" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."starts_on" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."ends_on" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."max_uses" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."used_count" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."is_active" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."created_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_code"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_redemption"."redemption_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_redemption"."payment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_redemption"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_redemption"."list_price_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_redemption"."discount_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_redemption"."is_released" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "promo_redemption"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."bundle_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."name_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."name_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."segment_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."price_poisha" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."course_ids" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."is_active" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."created_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payment"."discount_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payment"."promo_code_id" IS 'data-class C2 (Internal).';
