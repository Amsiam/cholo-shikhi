CREATE TABLE "staff_invitation" (
	"invitation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"instructor_type" text,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "staff_invitation_type_ck" CHECK (("staff_invitation"."role" = 'instructor') = ("staff_invitation"."instructor_type" is not null))
);
--> statement-breakpoint
ALTER TABLE "staff_invitation" ADD CONSTRAINT "staff_invitation_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation" ADD CONSTRAINT "staff_invitation_invited_by_user_account_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation" ADD CONSTRAINT "staff_invitation_cancelled_by_user_account_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitation_token_uq" ON "staff_invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitation_open_uq" ON "staff_invitation" USING btree ("user_id","role") WHERE "staff_invitation"."accepted_at" is null and "staff_invitation"."cancelled_at" is null;