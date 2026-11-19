CREATE TABLE "buddy_invite" (
	"invite_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" uuid NOT NULL,
	"code" text NOT NULL,
	"segment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "buddy_invite_code_ck" CHECK ("buddy_invite"."code" ~ '^[A-Z0-9]{6}$')
);
--> statement-breakpoint
CREATE TABLE "buddy_member" (
	"pair_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	CONSTRAINT "buddy_member_pair_id_user_id_pk" PRIMARY KEY("pair_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "buddy_pair" (
	"pair_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"starts_day" text NOT NULL,
	"ends_day" text,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buddy_pair_days_ck" CHECK ("buddy_pair"."ends_day" is null or "buddy_pair"."ends_day" > "buddy_pair"."starts_day")
);
--> statement-breakpoint
ALTER TABLE "buddy_member" ADD CONSTRAINT "buddy_member_pair_id_buddy_pair_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."buddy_pair"("pair_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_invite_open_code_uq" ON "buddy_invite" USING btree ("code") WHERE "buddy_invite"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "buddy_invite_inviter_idx" ON "buddy_invite" USING btree ("inviter_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_member_open_uq" ON "buddy_member" USING btree ("user_id") WHERE "buddy_member"."is_open";--> statement-breakpoint
CREATE INDEX "buddy_member_user_idx" ON "buddy_member" USING btree ("user_id");--> statement-breakpoint
COMMENT ON COLUMN "buddy_invite"."invite_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_invite"."inviter_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_invite"."code" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_invite"."segment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_invite"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_invite"."expires_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_invite"."accepted_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_invite"."closed_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_pair"."pair_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_pair"."segment_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_pair"."starts_day" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_pair"."ends_day" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_pair"."ended_by" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_pair"."created_at" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_member"."pair_id" IS 'data-class C2 (Internal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_member"."user_id" IS 'data-class C3 (Personal).';--> statement-breakpoint
COMMENT ON COLUMN "buddy_member"."is_open" IS 'data-class C2 (Internal).';