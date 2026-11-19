ALTER TABLE "lesson_version" ADD COLUMN "streak_bonus_days" integer;--> statement-breakpoint
ALTER TABLE "lesson_version" ADD CONSTRAINT "lesson_version_streak_bonus_ck" CHECK ("lesson_version"."streak_bonus_days" is null or "lesson_version"."streak_bonus_days" between 1 and 365);--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."streak_bonus_days" IS 'data-class C1 (Public).';