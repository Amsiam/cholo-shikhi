CREATE TABLE "attribution_case" (
	"case_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"claimant_ids" uuid[] NOT NULL,
	"description" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"owner_id" uuid,
	"reason" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "attribution_case_state_ck" CHECK ("attribution_case"."state" in ('open', 'resolved')),
	CONSTRAINT "attribution_case_claimants_ck" CHECK (cardinality("attribution_case"."claimant_ids") >= 1),
	CONSTRAINT "attribution_case_resolved_ck" CHECK (("attribution_case"."state" = 'resolved') = ("attribution_case"."owner_id" is not null and "attribution_case"."reason" is not null and "attribution_case"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "attribution_case_state_idx" ON "attribution_case" USING btree ("state","opened_at");--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."case_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."section_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."claimant_ids" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."description" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."state" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."opened_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."opened_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."owner_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."reason" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."resolved_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "attribution_case"."resolved_at" IS 'data-class C2 (Internal).';
