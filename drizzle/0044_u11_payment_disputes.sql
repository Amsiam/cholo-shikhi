CREATE TABLE "dispute_evidence_pack" (
	"pack_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dispute_evidence_pack_dispute_uq" UNIQUE("dispute_id"),
	CONSTRAINT "dispute_evidence_pack_hash_ck" CHECK ("dispute_evidence_pack"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payment_dispute" (
	"dispute_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"gateway_case_ref" text NOT NULL,
	"reason" text NOT NULL,
	"disputed_poisha" bigint NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payment_dispute_payment_uq" UNIQUE("payment_id"),
	CONSTRAINT "payment_dispute_amount_ck" CHECK ("payment_dispute"."disputed_poisha" >= 1)
);
--> statement-breakpoint
ALTER TABLE "dispute_evidence_pack" ADD CONSTRAINT "dispute_evidence_pack_dispute_id_payment_dispute_dispute_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."payment_dispute"("dispute_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_dispute_recorded_idx" ON "payment_dispute" USING btree ("recorded_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION dispute_evidence_pack_is_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- US9.3 (AC9.3.2): a generated evidence pack is locked; it can never be edited or deleted.
  RAISE EXCEPTION 'dispute evidence pack is locked: it cannot be edited or deleted' USING ERRCODE = 'P0001';
END $$;--> statement-breakpoint
CREATE TRIGGER dispute_evidence_pack_locked BEFORE UPDATE OR DELETE ON dispute_evidence_pack FOR EACH ROW EXECUTE FUNCTION dispute_evidence_pack_is_locked();--> statement-breakpoint
COMMENT ON COLUMN "payment_dispute"."dispute_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payment_dispute"."payment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payment_dispute"."gateway_case_ref" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payment_dispute"."reason" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payment_dispute"."disputed_poisha" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "payment_dispute"."recorded_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "payment_dispute"."recorded_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "dispute_evidence_pack"."pack_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "dispute_evidence_pack"."content" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "dispute_evidence_pack"."sha256" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "dispute_evidence_pack"."locked_at" IS 'data-class C2 (Internal).';
