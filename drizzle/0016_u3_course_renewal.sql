CREATE TABLE "enrolment_renewal" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"previous_ends_at" timestamp with time zone NOT NULL,
	"new_ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrolment_renewal_window_ck" CHECK ("enrolment_renewal"."new_ends_at" > "enrolment_renewal"."previous_ends_at")
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "kind" text DEFAULT 'purchase' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolment_renewal" ADD CONSTRAINT "enrolment_renewal_payment_id_payment_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("payment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment_renewal" ADD CONSTRAINT "enrolment_renewal_enrolment_id_enrolment_enrolment_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolment"("enrolment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrolment_renewal_enrolment_idx" ON "enrolment_renewal" USING btree ("enrolment_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_kind_ck" CHECK ("payment"."kind" in ('purchase', 'renewal'));--> statement-breakpoint
COMMENT ON COLUMN "payment"."kind" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "enrolment_renewal"."payment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "enrolment_renewal"."enrolment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "enrolment_renewal"."previous_ends_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "enrolment_renewal"."new_ends_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "enrolment_renewal"."created_at" IS 'data-class C2 (Internal).';
