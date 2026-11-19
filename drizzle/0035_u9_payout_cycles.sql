CREATE TABLE "payout_cycle" (
	"cycle_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"input_hash" text NOT NULL,
	"total_earned" bigint NOT NULL,
	"total_payout" bigint NOT NULL,
	"total_carry_in" bigint NOT NULL,
	"total_carry_out" bigint NOT NULL,
	"committed_by" uuid NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payout_cycle_month_uq" UNIQUE("month"),
	CONSTRAINT "payout_cycle_month_ck" CHECK ("payout_cycle"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payout_cycle_hash_ck" CHECK ("payout_cycle"."input_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payout_line" (
	"line_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"earned" bigint NOT NULL,
	"carry_in" bigint NOT NULL,
	"payout" bigint NOT NULL,
	"carry_out" bigint NOT NULL,
	"state" text NOT NULL,
	"hold_reason" text,
	"hold_note" text,
	"provider_ref" text,
	"idempotency_key" text,
	"disbursed_at" timestamp with time zone,
	"disbursed_by" uuid,
	"released_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payout_line_cycle_instructor_uq" UNIQUE("cycle_id","instructor_id"),
	CONSTRAINT "payout_line_idempotency_uq" UNIQUE("idempotency_key"),
	CONSTRAINT "payout_line_amounts_ck" CHECK ("payout_line"."payout" >= 0 and "payout_line"."carry_in" >= 0 and "payout_line"."carry_out" >= 0),
	CONSTRAINT "payout_line_conservation_ck" CHECK ("payout_line"."payout" - "payout_line"."carry_out" = "payout_line"."earned" - "payout_line"."carry_in"),
	CONSTRAINT "payout_line_state_ck" CHECK ("payout_line"."state" in ('pending', 'held', 'disbursed')),
	CONSTRAINT "payout_line_hold_ck" CHECK (("payout_line"."state" = 'held') = ("payout_line"."hold_reason" is not null)),
	CONSTRAINT "payout_line_paid_ck" CHECK (("payout_line"."state" = 'disbursed') = ("payout_line"."disbursed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "payout_line" ADD CONSTRAINT "payout_line_cycle_id_payout_cycle_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."payout_cycle"("cycle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_line_instructor_idx" ON "payout_line" USING btree ("instructor_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION payout_snapshot_is_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- US7.3 (AC7.3.2): a committed cycle never changes, and a line's amounts never change;
  -- only a line's payment state, references and timestamps move forward.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout snapshot is locked: % rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'payout_cycle' THEN
    RAISE EXCEPTION 'payout snapshot is locked: a committed cycle cannot be edited' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.cycle_id IS DISTINCT FROM OLD.cycle_id OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
     OR NEW.earned IS DISTINCT FROM OLD.earned OR NEW.carry_in IS DISTINCT FROM OLD.carry_in
     OR NEW.payout IS DISTINCT FROM OLD.payout OR NEW.carry_out IS DISTINCT FROM OLD.carry_out THEN
    RAISE EXCEPTION 'payout snapshot is locked: line amounts cannot be edited' USING ERRCODE = 'P0001';
  END IF;
  -- A paid line is final.
  IF OLD.state = 'disbursed' THEN
    RAISE EXCEPTION 'payout snapshot is locked: a disbursed line cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER payout_cycle_locked BEFORE UPDATE OR DELETE ON payout_cycle FOR EACH ROW EXECUTE FUNCTION payout_snapshot_is_locked();--> statement-breakpoint
CREATE TRIGGER payout_line_locked BEFORE UPDATE OR DELETE ON payout_line FOR EACH ROW EXECUTE FUNCTION payout_snapshot_is_locked();--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."cycle_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."month" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."period_end" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."input_hash" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."total_earned" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."total_payout" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."total_carry_in" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."total_carry_out" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."committed_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_cycle"."committed_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."line_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."cycle_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."instructor_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."earned" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."carry_in" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."payout" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."carry_out" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."state" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."hold_reason" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."hold_note" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."provider_ref" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."idempotency_key" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."disbursed_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."disbursed_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."released_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payout_line"."updated_at" IS 'data-class C2 (Internal).';