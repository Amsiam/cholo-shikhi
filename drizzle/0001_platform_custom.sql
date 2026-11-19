-- Hand-written, forward-only (TS-03). Schema-agnostic: no object is qualified with a schema name,
-- so the same SQL applies to `public` and to per-test-file schemas via search_path.

-- Audit log: append-only (BR7.3), yearly range partitions (SD-12 / R-03). Retention (BR7.4) drops
-- whole partitions older than audit.retentionYears; rows are never updated or deleted.
CREATE TABLE "audit_log_entry" (
  "audit_entry_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "actor_id" text NOT NULL,
  "action" text NOT NULL CHECK (char_length("action") <= 120),
  "subject_type" text NOT NULL CHECK (char_length("subject_type") <= 80),
  "subject_id" text NOT NULL CHECK (char_length("subject_id") <= 200),
  "before" jsonb,
  "after" jsonb,
  "reason" text CHECK ("reason" IS NULL OR char_length("reason") <= 1000),
  "correlation_id" text NOT NULL CHECK (char_length("correlation_id") <= 100),
  "occurred_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("audit_entry_id", "occurred_at")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
DO $$
DECLARE y int;
BEGIN
  FOR y IN 2026..2040 LOOP
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF "audit_log_entry" FOR VALUES FROM (%L) TO (%L)',
      'audit_log_entry_y' || y, y || '-01-01T00:00:00Z', (y + 1) || '-01-01T00:00:00Z');
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TABLE "audit_log_entry_default" PARTITION OF "audit_log_entry" DEFAULT;
--> statement-breakpoint
CREATE INDEX "audit_log_entry_subject_idx" ON "audit_log_entry" ("subject_type", "subject_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "audit_log_entry_occurred_idx" ON "audit_log_entry" ("occurred_at" DESC);
--> statement-breakpoint
CREATE FUNCTION audit_log_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_entry is append-only (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "audit_log_entry"
  FOR EACH ROW EXECUTE FUNCTION audit_log_refuse_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log_entry"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_refuse_change();
--> statement-breakpoint

-- Outbox partitioning: one deterministic function used by every producer path (contract 2).
CREATE FUNCTION outbox_partition_of(key text, partitions int DEFAULT 32) RETURNS int
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT ((hashtext(key) % partitions) + partitions) % partitions $$;
--> statement-breakpoint
-- Wake the relay on commit (LISTEN/NOTIFY); the relay also polls every second as a backstop.
CREATE FUNCTION outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox_event', NEW.partition::text);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbox_event_notify AFTER INSERT ON "outbox_event"
  FOR EACH ROW EXECUTE FUNCTION outbox_notify();
--> statement-breakpoint

-- BR2.3: AccountCreated is written in the SAME transaction as the account row, whichever code path
-- inserts it (Better Auth owns the insert). Payload carries IDs and timestamps only (contract 4).
CREATE FUNCTION identity_account_created() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "outbox_event" ("outbox_event_id", "event_type", "version", "aggregate_key", "partition",
    "producer", "payload", "correlation_id", "occurred_at", "recorded_at")
  VALUES (gen_random_uuid(), 'identity.AccountCreated', 1, NEW.user_id::text,
    outbox_partition_of(NEW.user_id::text), 'identity-access',
    jsonb_build_object(
      'userId', NEW.user_id,
      'createdAt', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'referralCode', NULL,
      'deviceFingerprintHash', NULL),
    coalesce(nullif(current_setting('app.correlation_id', true), ''), 'db:' || gen_random_uuid()::text),
    NEW.created_at, now());
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_account_created AFTER INSERT ON "user_account"
  FOR EACH ROW EXECUTE FUNCTION identity_account_created();
--> statement-breakpoint

-- System-generated student numbers, never user-chosen (entities.md UserAccount.studentNumber).
CREATE SEQUENCE "student_number_seq" START 100001;
--> statement-breakpoint
CREATE FUNCTION identity_assign_student_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_number IS NULL THEN
    NEW.student_number := 'CS' || nextval('student_number_seq')::text;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_account_student_number BEFORE INSERT ON "user_account"
  FOR EACH ROW EXECUTE FUNCTION identity_assign_student_number();
--> statement-breakpoint

-- Entity constraints that the generated DDL does not express.
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_rollout_range" CHECK ("rollout_percent" BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_targeted_restriction" CHECK (
  "state" <> 'targeted' OR cardinality("target_roles") > 0 OR cardinality("target_goal_segment_ids") > 0 OR "rollout_percent" < 100);
--> statement-breakpoint
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_instructor_type" CHECK (
  ("role" = 'instructor' AND "instructor_type" IS NOT NULL) OR ("role" <> 'instructor' AND "instructor_type" IS NULL));
--> statement-breakpoint
ALTER TABLE "setting_version" ADD CONSTRAINT "setting_version_reason_len" CHECK (char_length("reason") BETWEEN 3 AND 500);
--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD CONSTRAINT "outbox_delivery_attempts_range" CHECK ("attempts" BETWEEN 0 AND 5);
--> statement-breakpoint
ALTER TABLE "outbox_delivery" ADD CONSTRAINT "outbox_delivery_discard_reason" CHECK (
  "status" <> 'discarded' OR char_length(coalesce("discard_justification", '')) BETWEEN 10 AND 1000);
--> statement-breakpoint
ALTER TABLE "rendered_document" ADD CONSTRAINT "rendered_document_retention" CHECK ("retain_until" > "created_at");
--> statement-breakpoint
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_max_attempts" CHECK ("max_attempts" BETWEEN 1 AND 10);
--> statement-breakpoint
INSERT INTO "partition_lease" ("partition") SELECT generate_series(0, 31);
