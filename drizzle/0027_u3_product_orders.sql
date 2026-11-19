CREATE TABLE "product_access" (
	"access_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_type" text NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_access_order_uq" UNIQUE("order_id"),
	CONSTRAINT "product_access_window_ck" CHECK ("product_access"."ends_at" > "product_access"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "product_order" (
	"order_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_type" text NOT NULL,
	"product_id" uuid NOT NULL,
	"course_id" uuid,
	"title_bn" text NOT NULL,
	"title_en" text NOT NULL,
	"amount_poisha" bigint NOT NULL,
	"access_months" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"gateway" text DEFAULT 'fake' NOT NULL,
	"gateway_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "product_order_type_ck" CHECK ("product_order"."product_type" in ('practice_pack', 'exam_package', 'subscription_plan')),
	CONSTRAINT "product_order_amount_ck" CHECK ("product_order"."amount_poisha" >= 1),
	CONSTRAINT "product_order_months_ck" CHECK ("product_order"."access_months" in (1, 6)),
	CONSTRAINT "product_order_status_ck" CHECK ("product_order"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "product_order_settled_ck" CHECK (("product_order"."status" = 'pending') = ("product_order"."settled_at" is null)),
	CONSTRAINT "product_order_pack_course_ck" CHECK ("product_order"."product_type" <> 'practice_pack' or "product_order"."course_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "ledger_transaction" DROP CONSTRAINT "ledger_tx_kind_ck";--> statement-breakpoint
ALTER TABLE "ledger_transaction" ALTER COLUMN "course_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "package_version_id" uuid;--> statement-breakpoint
ALTER TABLE "product_access" ADD CONSTRAINT "product_access_order_id_product_order_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."product_order"("order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_access_user_idx" ON "product_access" USING btree ("user_id","product_type","product_id","ends_at");--> statement-breakpoint
CREATE INDEX "product_order_user_idx" ON "product_order" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_package_version_uq" ON "exam" USING btree ("package_version_id") WHERE "exam"."package_version_id" is not null;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_course_ck" CHECK ("ledger_transaction"."kind" = 'platform_sale' or "ledger_transaction"."course_id" is not null);--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_tx_kind_ck" CHECK ("ledger_transaction"."kind" in ('course_sale', 'course_refund', 'platform_sale'));--> statement-breakpoint
COMMENT ON COLUMN "product_order"."order_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."product_type" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."product_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."title_bn" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."title_en" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."amount_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."access_months" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."gateway" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."gateway_ref" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_order"."settled_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_access"."access_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_access"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "product_access"."product_type" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_access"."product_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_access"."order_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_access"."starts_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_access"."ends_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "product_access"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "exam"."package_version_id" IS 'data-class C2 (Internal).';
