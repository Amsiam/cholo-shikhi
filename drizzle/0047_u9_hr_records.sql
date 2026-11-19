CREATE TABLE "employee_record" (
	"instructor_id" uuid PRIMARY KEY NOT NULL,
	"salary_poisha" bigint,
	"joined_on" date,
	"exit_on" date,
	"leave_balance_days" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "employee_record_salary_ck" CHECK ("employee_record"."salary_poisha" is null or "employee_record"."salary_poisha" >= 0),
	CONSTRAINT "employee_record_dates_ck" CHECK ("employee_record"."exit_on" is null or "employee_record"."joined_on" is null or "employee_record"."exit_on" >= "employee_record"."joined_on"),
	CONSTRAINT "employee_record_balance_ck" CHECK ("employee_record"."leave_balance_days" between 0 and 366)
);
--> statement-breakpoint
CREATE TABLE "leave_entry" (
	"entry_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"days" integer NOT NULL,
	"is_without_leave" boolean NOT NULL,
	"balance_after" integer NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "leave_entry_kind_ck" CHECK ("leave_entry"."kind" in ('leave', 'absence')),
	CONSTRAINT "leave_entry_dates_ck" CHECK ("leave_entry"."ends_on" >= "leave_entry"."starts_on"),
	CONSTRAINT "leave_entry_days_ck" CHECK ("leave_entry"."days" >= 1 and "leave_entry"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pay_policy_version" (
	"version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"share_bps" integer,
	"salary_poisha" bigint,
	"per_piece_poisha" bigint,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pay_policy_version_uq" UNIQUE("instructor_id","version"),
	CONSTRAINT "pay_policy_version_ck" CHECK ("pay_policy_version"."version" >= 1),
	CONSTRAINT "pay_policy_kind_ck" CHECK ("pay_policy_version"."kind" in ('revenue_share', 'salary', 'per_piece', 'hybrid')),
	CONSTRAINT "pay_policy_components_ck" CHECK (("pay_policy_version"."kind" = 'revenue_share' and "pay_policy_version"."share_bps" is not null and "pay_policy_version"."salary_poisha" is null and "pay_policy_version"."per_piece_poisha" is null)
        or ("pay_policy_version"."kind" = 'salary' and "pay_policy_version"."salary_poisha" is not null and "pay_policy_version"."share_bps" is null and "pay_policy_version"."per_piece_poisha" is null)
        or ("pay_policy_version"."kind" = 'per_piece' and "pay_policy_version"."per_piece_poisha" is not null and "pay_policy_version"."share_bps" is null and "pay_policy_version"."salary_poisha" is null)
        or ("pay_policy_version"."kind" = 'hybrid' and "pay_policy_version"."salary_poisha" is not null and "pay_policy_version"."share_bps" is not null and "pay_policy_version"."per_piece_poisha" is null)),
	CONSTRAINT "pay_policy_amounts_ck" CHECK (("pay_policy_version"."share_bps" is null or "pay_policy_version"."share_bps" between 0 and 10000) and coalesce("pay_policy_version"."salary_poisha", 0) >= 0 and coalesce("pay_policy_version"."per_piece_poisha", 0) >= 0)
);
--> statement-breakpoint
CREATE INDEX "leave_entry_instructor_idx" ON "leave_entry" USING btree ("instructor_id","starts_on");--> statement-breakpoint
CREATE INDEX "pay_policy_instructor_idx" ON "pay_policy_version" USING btree ("instructor_id","effective_from");--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."version_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."instructor_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."version" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."kind" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."share_bps" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."salary_poisha" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."per_piece_poisha" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."effective_from" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."created_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "pay_policy_version"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "employee_record"."instructor_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "employee_record"."salary_poisha" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "employee_record"."joined_on" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "employee_record"."exit_on" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "employee_record"."leave_balance_days" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "employee_record"."updated_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "employee_record"."updated_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."entry_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."instructor_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."kind" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."starts_on" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."ends_on" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."days" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."is_without_leave" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."balance_after" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."note" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."recorded_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "leave_entry"."recorded_at" IS 'data-class C2 (Internal).';
