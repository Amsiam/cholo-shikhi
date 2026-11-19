CREATE TABLE "course_nps" (
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"score" integer,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "course_nps_user_id_course_id_pk" PRIMARY KEY("user_id","course_id"),
	CONSTRAINT "course_nps_score_ck" CHECK ("course_nps"."score" is null or "course_nps"."score" between 0 and 10)
);
--> statement-breakpoint
CREATE INDEX "course_nps_course_idx" ON "course_nps" USING btree ("course_id");--> statement-breakpoint
COMMENT ON COLUMN "course_nps"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "course_nps"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "course_nps"."score" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "course_nps"."answered_at" IS 'data-class C3 (Personal).';