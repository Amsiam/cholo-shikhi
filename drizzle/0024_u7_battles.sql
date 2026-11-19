CREATE TABLE "battle" (
	"battle_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"band" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"code" text,
	"title_bn" text,
	"title_en" text,
	"topic_id" uuid,
	"source" text DEFAULT 'bank' NOT NULL,
	"question_count" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"max_players" integer NOT NULL,
	"question_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_mode_ck" CHECK ("battle"."mode" in ('quick', 'friend', 'hosted')),
	CONSTRAINT "battle_status_ck" CHECK ("battle"."status" in ('waiting', 'running', 'finished', 'cancelled')),
	CONSTRAINT "battle_source_ck" CHECK ("battle"."source" in ('bank', 'vault')),
	CONSTRAINT "battle_count_ck" CHECK ("battle"."question_count" between 1 and 50),
	CONSTRAINT "battle_duration_ck" CHECK ("battle"."duration_seconds" between 30 and 3600),
	CONSTRAINT "battle_players_ck" CHECK ("battle"."max_players" between 2 and 500),
	CONSTRAINT "battle_hosted_ck" CHECK ("battle"."mode" <> 'hosted' or ("battle"."starts_at" is not null and "battle"."title_en" is not null)),
	CONSTRAINT "battle_friend_code_ck" CHECK ("battle"."mode" <> 'friend' or "battle"."code" is not null)
);
--> statement-breakpoint
CREATE TABLE "battle_player" (
	"battle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correct_count" integer,
	"finished_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "battle_player_battle_id_user_id_pk" PRIMARY KEY("battle_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "battle_player" ADD CONSTRAINT "battle_player_battle_id_battle_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("battle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "battle_open_code_uq" ON "battle" USING btree ("code") WHERE "battle"."code" is not null and "battle"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "battle_queue_idx" ON "battle" USING btree ("mode","status","band","created_at");--> statement-breakpoint
CREATE INDEX "battle_hosted_idx" ON "battle" USING btree ("band","status","starts_at");--> statement-breakpoint
CREATE INDEX "battle_player_user_idx" ON "battle_player" USING btree ("user_id","joined_at");--> statement-breakpoint
COMMENT ON COLUMN "battle"."battle_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."mode" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."status" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."band" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."goal_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."host_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."code" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."title_bn" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."title_en" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."topic_id" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."source" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."question_count" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."duration_seconds" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."max_players" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."question_ids" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."starts_at" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."ends_at" IS 'data-class C1 (Public).';--> statement-breakpoint
COMMENT ON COLUMN "battle"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle_player"."battle_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "battle_player"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "battle_player"."joined_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "battle_player"."answers" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "battle_player"."correct_count" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "battle_player"."finished_at" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "battle_player"."settled_at" IS 'data-class C2 (Internal).';
