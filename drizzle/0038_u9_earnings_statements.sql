CREATE TABLE "earnings_statement" (
	"statement_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"month" text NOT NULL,
	"version" integer NOT NULL,
	"locale" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "earnings_statement_version_uq" UNIQUE("instructor_id","month","version","locale"),
	CONSTRAINT "earnings_statement_month_ck" CHECK ("earnings_statement"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "earnings_statement_version_ck" CHECK ("earnings_statement"."version" >= 1),
	CONSTRAINT "earnings_statement_retention_ck" CHECK ("earnings_statement"."retain_until" > "earnings_statement"."created_at")
);
--> statement-breakpoint
CREATE INDEX "earnings_statement_instructor_idx" ON "earnings_statement" USING btree ("instructor_id","month");--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."statement_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."instructor_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."month" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."version" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."locale" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."object_key" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."sha256" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "earnings_statement"."retain_until" IS 'data-class C2 (Internal).';