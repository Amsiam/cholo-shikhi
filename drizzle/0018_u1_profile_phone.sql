ALTER TABLE "user_account" ADD COLUMN "phone_e164" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_phone_uq" ON "user_account" USING btree ("phone_e164") WHERE "user_account"."phone_e164" is not null;--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_phone_ck" CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\+8801[3-9][0-9]{8}$');--> statement-breakpoint
COMMENT ON COLUMN "user_account"."phone_e164" IS 'data-class C3 (Personal).';
