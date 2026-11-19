CREATE TABLE "learner_notice" (
	"user_id" uuid NOT NULL,
	"notice" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "learner_notice_user_id_notice_pk" PRIMARY KEY("user_id","notice"),
	CONSTRAINT "learner_notice_notice_ck" CHECK ("learner_notice"."notice" in ('video_badge'))
);
--> statement-breakpoint
COMMENT ON COLUMN "learner_notice"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "learner_notice"."notice" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "learner_notice"."seen_at" IS 'data-class C3 (Personal).';