CREATE TABLE "streak_activity" (
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"day" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "streak_activity_user_id_course_id_kind_day_pk" PRIMARY KEY("user_id","course_id","kind","day"),
	CONSTRAINT "streak_activity_kind_ck" CHECK ("streak_activity"."kind" in ('live')),
	CONSTRAINT "streak_activity_day_ck" CHECK ("streak_activity"."day" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "streak_shield" (
	"shield_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"used_for_day" text,
	"used_at" timestamp with time zone,
	CONSTRAINT "streak_shield_once_uq" UNIQUE("user_id","source","source_ref"),
	CONSTRAINT "streak_shield_source_ck" CHECK ("streak_shield"."source" in ('live_quiz', 'admin')),
	CONSTRAINT "streak_shield_day_ck" CHECK ("streak_shield"."used_for_day" is null or "streak_shield"."used_for_day" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "token_account" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_account_balance_ck" CHECK ("token_account"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "token_entry" (
	"entry_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" text NOT NULL,
	"balance_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_entry_once_uq" UNIQUE("user_id","reason","ref"),
	CONSTRAINT "token_entry_delta_ck" CHECK ("token_entry"."delta" <> 0),
	CONSTRAINT "token_entry_reason_ck" CHECK ("token_entry"."reason" in ('daily', 'battle_entry', 'battle_refund', 'buddy_bonus', 'admin')),
	CONSTRAINT "token_entry_balance_ck" CHECK ("token_entry"."balance_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "live_quiz" ADD COLUMN "shields_awarded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "streak_shield_day_uq" ON "streak_shield" USING btree ("user_id","used_for_day") WHERE "streak_shield"."used_for_day" is not null;--> statement-breakpoint
CREATE INDEX "streak_shield_user_idx" ON "streak_shield" USING btree ("user_id","earned_at");--> statement-breakpoint
CREATE INDEX "token_entry_user_idx" ON "token_entry" USING btree ("user_id","created_at");--> statement-breakpoint
COMMENT ON COLUMN "token_account"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "token_account"."balance" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "token_account"."updated_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "token_entry"."entry_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "token_entry"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "token_entry"."delta" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "token_entry"."reason" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "token_entry"."ref" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "token_entry"."balance_after" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "token_entry"."created_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_shield"."shield_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_shield"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_shield"."source" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_shield"."source_ref" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_shield"."earned_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_shield"."used_for_day" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_shield"."used_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_activity"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_activity"."course_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_activity"."kind" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_activity"."day" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "streak_activity"."at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "live_quiz"."shields_awarded_at" IS 'data-class C2 (Internal).';