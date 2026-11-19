CREATE TABLE "bundle_order" (
	"order_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"name_bn" text NOT NULL,
	"name_en" text NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"gateway" text DEFAULT 'fake' NOT NULL,
	"gateway_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "bundle_order_amount_ck" CHECK ("bundle_order"."amount_poisha" >= 1),
	CONSTRAINT "bundle_order_status_ck" CHECK ("bundle_order"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "bundle_order_settled_ck" CHECK (("bundle_order"."status" = 'pending') = ("bundle_order"."settled_at" is null))
);
--> statement-breakpoint
CREATE TABLE "bundle_order_item" (
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"course_id" uuid NOT NULL,
	"list_price_poisha" bigint NOT NULL,
	"allocated_poisha" bigint NOT NULL,
	"access_duration_months" integer NOT NULL,
	"payment_id" uuid,
	CONSTRAINT "bundle_order_item_order_id_position_pk" PRIMARY KEY("order_id","position"),
	CONSTRAINT "bundle_order_item_course_uq" UNIQUE("order_id","course_id"),
	CONSTRAINT "bundle_order_item_amount_ck" CHECK ("bundle_order_item"."allocated_poisha" >= 1),
	CONSTRAINT "bundle_order_item_months_ck" CHECK ("bundle_order_item"."access_duration_months" in (4, 6, 12))
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "bundle_order_id" uuid;--> statement-breakpoint
ALTER TABLE "bundle_order_item" ADD CONSTRAINT "bundle_order_item_order_id_bundle_order_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bundle_order"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bundle_order_user_idx" ON "bundle_order" USING btree ("user_id","created_at");--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."order_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."bundle_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."name_bn" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."name_en" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."amount_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."gateway" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."gateway_ref" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order"."settled_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order_item"."order_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order_item"."position" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order_item"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order_item"."list_price_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order_item"."allocated_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order_item"."access_duration_months" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "bundle_order_item"."payment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payment"."bundle_order_id" IS 'data-class C2 (Internal).';
