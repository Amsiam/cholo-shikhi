CREATE TABLE "payout_statement" (
	"statement_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"format" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "payout_statement_line_locale_uq" UNIQUE("line_id","locale","format"),
	CONSTRAINT "payout_statement_locale_ck" CHECK ("payout_statement"."locale" in ('bn', 'en')),
	CONSTRAINT "payout_statement_retention_ck" CHECK ("payout_statement"."retain_until" > "payout_statement"."created_at")
);
--> statement-breakpoint
ALTER TABLE "payout_statement" ADD CONSTRAINT "payout_statement_line_id_payout_line_line_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payout_line"("line_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
COMMENT ON COLUMN "payout_statement"."statement_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_statement"."line_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_statement"."locale" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_statement"."format" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_statement"."object_key" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_statement"."sha256" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_statement"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_statement"."retain_until" IS 'data-class C2 (Internal).';