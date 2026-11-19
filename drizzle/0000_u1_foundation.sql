CREATE TABLE "auth_account" (
	"account_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limit" (
	"rate_limit_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request_epoch_s" integer NOT NULL,
	CONSTRAINT "auth_rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"tier" text DEFAULT 'student' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"step_up_verified_at" timestamp with time zone,
	"tier_anchor_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"end_reason" text,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"verification_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_bucket" (
	"bucket_key" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recovery_code" (
	"recovery_code_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"two_factor_credential_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_role_assignment" (
	"role_assignment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"instructor_type" text,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "two_factor_credential" (
	"two_factor_credential_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"totp_secret_ref" text NOT NULL,
	"status" text DEFAULT 'pending_confirmation' NOT NULL,
	"last_accepted_step" integer,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_account" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"email_normalised" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"image" text,
	"locale" text DEFAULT 'bn' NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"student_number" text,
	"password_changed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"flag_key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"state" text DEFAULT 'off' NOT NULL,
	"target_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"target_goal_segment_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"rollout_percent" integer DEFAULT 100 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_check_result" (
	"health_check_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_name" text NOT NULL,
	"status_component" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instrumentation_event" (
	"instrumentation_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"feature_area" text NOT NULL,
	"correlation_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"properties" jsonb
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"job_run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_digest" text NOT NULL,
	"payload" jsonb,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lock_owner" text,
	"lock_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error_code" text,
	"result_summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "outbox_delivery" (
	"outbox_delivery_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_event_id" uuid NOT NULL,
	"event_seq" integer NOT NULL,
	"consumer_name" text NOT NULL,
	"aggregate_key" text NOT NULL,
	"partition" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"attempt_times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"handled_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"resolved_by" uuid,
	"discard_justification" text
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"seq" bigserial NOT NULL,
	"outbox_event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"version" integer NOT NULL,
	"aggregate_key" text NOT NULL,
	"partition" integer NOT NULL,
	"producer" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fanned_out_at" timestamp with time zone,
	CONSTRAINT "outbox_event_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "partition_lease" (
	"partition" integer PRIMARY KEY NOT NULL,
	"worker_id" text,
	"heartbeat_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_event" (
	"consumer_name" text NOT NULL,
	"outbox_event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_event_consumer_name_outbox_event_id_pk" PRIMARY KEY("consumer_name","outbox_event_id")
);
--> statement-breakpoint
CREATE TABLE "rendered_document" (
	"document_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"template" text NOT NULL,
	"format" text NOT NULL,
	"locale" text NOT NULL,
	"requesting_feature" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "rendered_document_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "setting_version" (
	"setting_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_key" text NOT NULL,
	"scope_key" text DEFAULT 'global' NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"changed_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_attempt" (
	"delivery_attempt_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_delivery_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"provider_message_id" text,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"notification_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"params" jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"requested_channels" text[] NOT NULL,
	"resolved_channels" text[] NOT NULL,
	"status" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_delivery" (
	"notification_delivery_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"skip_reason" text,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"preference_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	"channel" text NOT NULL,
	"is_enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"push_subscription_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"endpoint" text NOT NULL,
	"keys_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_two_factor_credential_id_two_factor_credential_two_factor_credential_id_fk" FOREIGN KEY ("two_factor_credential_id") REFERENCES "public"."two_factor_credential"("two_factor_credential_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_assigned_by_user_account_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_revoked_by_user_account_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor_credential" ADD CONSTRAINT "two_factor_credential_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_token" ADD CONSTRAINT "verification_token_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_updated_by_user_account_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD CONSTRAINT "outbox_delivery_outbox_event_id_outbox_event_outbox_event_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_event"("outbox_event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD CONSTRAINT "outbox_delivery_resolved_by_user_account_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_version" ADD CONSTRAINT "setting_version_changed_by_user_account_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_notification_delivery_id_notification_delivery_notification_delivery_id_fk" FOREIGN KEY ("notification_delivery_id") REFERENCES "public"."notification_delivery"("notification_delivery_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_account_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("notification_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_account_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_session_id_auth_session_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_session"("session_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_uq" ON "auth_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "recovery_code_credential_idx" ON "recovery_code" USING btree ("two_factor_credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_role_active_uq" ON "staff_role_assignment" USING btree ("user_id","role") WHERE "staff_role_assignment"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_active_uq" ON "two_factor_credential" USING btree ("user_id") WHERE "two_factor_credential"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_email_uq" ON "user_account" USING btree ("email_normalised");--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_student_number_uq" ON "user_account" USING btree ("student_number");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_token_hash_uq" ON "verification_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_token_user_purpose_idx" ON "verification_token" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "health_check_component_idx" ON "health_check_result" USING btree ("status_component","checked_at");--> statement-breakpoint
CREATE INDEX "instrumentation_event_name_idx" ON "instrumentation_event" USING btree ("event_name","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_run_idempotency_uq" ON "job_run" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "job_run_due_idx" ON "job_run" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_delivery_uq" ON "outbox_delivery" USING btree ("outbox_event_id","consumer_name");--> statement-breakpoint
CREATE INDEX "outbox_delivery_work_idx" ON "outbox_delivery" USING btree ("partition","status","consumer_name","aggregate_key","event_seq");--> statement-breakpoint
CREATE INDEX "outbox_event_fanout_idx" ON "outbox_event" USING btree ("partition","seq") WHERE "outbox_event"."fanned_out_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "setting_version_uq" ON "setting_version" USING btree ("setting_key","scope_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_uq" ON "notification" USING btree ("recipient_user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_recipient_idx" ON "notification" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_uq" ON "notification_delivery" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_delivery_due_idx" ON "notification_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_uq" ON "notification_preference" USING btree ("user_id","type_key","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint_active_uq" ON "push_subscription" USING btree ("endpoint") WHERE "push_subscription"."revoked_at" is null;