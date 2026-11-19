ALTER TABLE "exam" ADD COLUMN "course_id" uuid;--> statement-breakpoint
CREATE INDEX "exam_course_idx" ON "exam" USING btree ("course_id","status");--> statement-breakpoint
ALTER TABLE "exam" ADD CONSTRAINT "exam_course_kind_ck" CHECK ("exam"."course_id" is null or "exam"."kind" <> 'custom');--> statement-breakpoint
COMMENT ON COLUMN "exam"."course_id" IS 'data-class C1 (Public).';
