ALTER TABLE "exam_attempt" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
COMMENT ON COLUMN "exam_attempt"."settled_at" IS 'data-class C2 (Internal).';
