CREATE TABLE "blocked_domain" (
	"blocked_domain_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "blocked_domain_domain_uq" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "course" (
	"course_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title_bn" text NOT NULL,
	"title_en" text NOT NULL,
	"description_bn" text,
	"description_en" text,
	"cover_image_key" text,
	"lead_instructor_id" uuid,
	"list_price_poisha" bigint,
	"access_duration_months" integer,
	"duration_locked_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"status_before_hidden" text,
	"active_takedown_notice_id" uuid,
	"first_published_at" timestamp with time zone,
	"last_published_at" timestamp with time zone,
	"unpublished_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"pin_rank" integer,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_status_ck" CHECK ("course"."status" in ('draft', 'published', 'unpublished', 'hidden', 'retired')),
	CONSTRAINT "course_status_before_hidden_ck" CHECK (("course"."status" = 'hidden') = ("course"."status_before_hidden" is not null)),
	CONSTRAINT "course_price_ck" CHECK ("course"."list_price_poisha" is null or "course"."list_price_poisha" >= 1),
	CONSTRAINT "course_duration_ck" CHECK ("course"."access_duration_months" is null or "course"."access_duration_months" in (4, 6, 12)),
	CONSTRAINT "course_duration_lock_ck" CHECK ("course"."duration_locked_at" is null or "course"."access_duration_months" is not null),
	CONSTRAINT "course_title_len_ck" CHECK (char_length("course"."title_bn") <= 150 and char_length("course"."title_en") <= 150),
	CONSTRAINT "course_pin_rank_ck" CHECK ("course"."pin_rank" is null or "course"."pin_rank" >= 1),
	CONSTRAINT "course_version_ck" CHECK ("course"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"lesson_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"live_state" text DEFAULT 'never_published' NOT NULL,
	"first_published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"hidden_by_takedown_notice_id" uuid,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_kind_ck" CHECK ("lesson"."kind" in ('video', 'text', 'quiz')),
	CONSTRAINT "lesson_live_state_ck" CHECK ("lesson"."live_state" in ('never_published', 'live', 'withdrawn')),
	CONSTRAINT "lesson_withdrawn_ck" CHECK (("lesson"."live_state" = 'withdrawn') = ("lesson"."withdrawn_at" is not null)),
	CONSTRAINT "lesson_version_ck" CHECK ("lesson"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lesson_version" (
	"lesson_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"section_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title_bn" text,
	"title_en" text,
	"body_bn" jsonb,
	"body_en" jsonb,
	"video_asset_id" uuid,
	"media_status" text DEFAULT 'none' NOT NULL,
	"caption_languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"quiz_question_count" integer DEFAULT 0 NOT NULL,
	"link_domain_candidates" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lesson_version_lesson_uq" UNIQUE("section_version_id","lesson_id"),
	CONSTRAINT "lesson_version_position_ck" CHECK ("lesson_version"."position" >= 1),
	CONSTRAINT "lesson_version_media_status_ck" CHECK ("lesson_version"."media_status" in ('none', 'processing', 'ready', 'failed')),
	CONSTRAINT "lesson_version_quiz_count_ck" CHECK ("lesson_version"."quiz_question_count" >= 0),
	CONSTRAINT "lesson_version_title_len_ck" CHECK (coalesce(char_length("lesson_version"."title_bn"), 0) <= 150 and coalesce(char_length("lesson_version"."title_en"), 0) <= 150),
	CONSTRAINT "lesson_version_version_ck" CHECK ("lesson_version"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ownership_period" (
	"section_ownership_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"assigned_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ownership_period_reason_ck" CHECK ("ownership_period"."reason" in ('default_lead', 'assigned', 'reassigned', 'co_instructor_removed', 'lead_changed')),
	CONSTRAINT "ownership_period_range_ck" CHECK ("ownership_period"."valid_to" is null or "ownership_period"."valid_to" >= "ownership_period"."valid_from"),
	CONSTRAINT "ownership_period_version_ck" CHECK ("ownership_period"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "section" (
	"section_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"pending_position" integer,
	"structure_state" text DEFAULT 'active' NOT NULL,
	"removal_requested_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"live_version_id" uuid,
	"working_version_id" uuid,
	"first_published_at" timestamp with time zone,
	"hidden_by_takedown_notice_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_position_ck" CHECK ("section"."position" >= 1),
	CONSTRAINT "section_pending_position_ck" CHECK ("section"."pending_position" is null or "section"."pending_position" >= 1),
	CONSTRAINT "section_structure_state_ck" CHECK ("section"."structure_state" in ('active', 'removal_pending', 'removed')),
	CONSTRAINT "section_removed_at_ck" CHECK (("section"."structure_state" = 'removed') = ("section"."removed_at" is not null)),
	CONSTRAINT "section_removal_requested_ck" CHECK ("section"."structure_state" <> 'removal_pending' or "section"."removal_requested_at" is not null),
	CONSTRAINT "section_version_ck" CHECK ("section"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "section_review" (
	"section_review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"section_version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "section_review_action_ck" CHECK ("section_review"."action" in ('submitted', 'approved', 'returned', 'self_approved', 'admin_approved', 'reopened', 'reset_by_reassignment', 'published', 'discarded')),
	CONSTRAINT "section_review_comment_ck" CHECK ("section_review"."comment" is null or char_length("section_review"."comment") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "section_version" (
	"section_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title_bn" text NOT NULL,
	"title_en" text NOT NULL,
	"review_state" text DEFAULT 'draft' NOT NULL,
	"based_on_version_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_version_number_uq" UNIQUE("section_id","version_number"),
	CONSTRAINT "section_version_review_state_ck" CHECK ("section_version"."review_state" in ('draft', 'in_review', 'approved', 'published', 'superseded', 'discarded')),
	CONSTRAINT "section_version_number_ck" CHECK ("section_version"."version_number" >= 1),
	CONSTRAINT "section_version_title_len_ck" CHECK (char_length("section_version"."title_bn") <= 150 and char_length("section_version"."title_en") <= 150),
	CONSTRAINT "section_version_version_ck" CHECK ("section_version"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_goal_id_goal_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("goal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_section_id_section_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("section_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_version" ADD CONSTRAINT "lesson_version_lesson_id_lesson_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("lesson_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_version" ADD CONSTRAINT "lesson_version_section_version_id_section_version_section_version_id_fk" FOREIGN KEY ("section_version_id") REFERENCES "public"."section_version"("section_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_period" ADD CONSTRAINT "ownership_period_section_id_section_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("section_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_course_id_course_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_live_version_id_section_version_section_version_id_fk" FOREIGN KEY ("live_version_id") REFERENCES "public"."section_version"("section_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_working_version_id_section_version_section_version_id_fk" FOREIGN KEY ("working_version_id") REFERENCES "public"."section_version"("section_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_review" ADD CONSTRAINT "section_review_section_id_section_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("section_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_review" ADD CONSTRAINT "section_review_section_version_id_section_version_section_version_id_fk" FOREIGN KEY ("section_version_id") REFERENCES "public"."section_version"("section_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_version" ADD CONSTRAINT "section_version_section_id_section_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("section_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_published_goal_idx" ON "course" USING btree ("goal_id","pin_rank","first_published_at" DESC NULLS LAST,"course_id") WHERE "course"."status" = 'published';--> statement-breakpoint
CREATE INDEX "course_lead_idx" ON "course" USING btree ("lead_instructor_id","updated_at" DESC NULLS LAST,"course_id");--> statement-breakpoint
CREATE INDEX "course_created_idx" ON "course" USING btree ("created_at" DESC NULLS LAST,"course_id");--> statement-breakpoint
CREATE INDEX "lesson_section_idx" ON "lesson" USING btree ("section_id","created_at");--> statement-breakpoint
CREATE INDEX "lesson_first_published_idx" ON "lesson" USING btree ("first_published_at");--> statement-breakpoint
CREATE INDEX "lesson_version_lesson_idx" ON "lesson_version" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_period_open_uq" ON "ownership_period" USING btree ("section_id") WHERE "ownership_period"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "ownership_period_section_idx" ON "ownership_period" USING btree ("section_id","valid_from");--> statement-breakpoint
CREATE INDEX "ownership_period_instructor_idx" ON "ownership_period" USING btree ("instructor_id","valid_from");--> statement-breakpoint
CREATE INDEX "section_course_position_idx" ON "section" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "section_review_section_idx" ON "section_review" USING btree ("section_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "section_version_live_uq" ON "section_version" USING btree ("section_id") WHERE "section_version"."review_state" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "section_version_working_uq" ON "section_version" USING btree ("section_id") WHERE "section_version"."review_state" in ('draft', 'in_review', 'approved');--> statement-breakpoint
CREATE INDEX "section_version_recent_idx" ON "section_version" USING btree ("section_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
-- Hand-written below (NFR6.206 / SD-207, RD-215, BR8.7, BR7.2), schema-agnostic like 0001.
-- BR7.2: lesson positions are unique within a section version, checked at commit so a reorder can
-- move every position in one transaction.
ALTER TABLE "lesson_version" ADD CONSTRAINT "lesson_version_position_uq" UNIQUE ("section_version_id", "position") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- NFR6.206 / SD-207: published, superseded and discarded section versions are immutable. The only
-- allowed change of a published version is to superseded. The retention purge (SD-227) runs as the
-- separate role catalog_retention, which needs the human's approval (Step 50) and does not exist yet.
CREATE FUNCTION catalog_section_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'catalog_retention' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF OLD.review_state IN ('published', 'superseded', 'discarded') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'section_version % is immutable', OLD.review_state USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW.section_id, NEW.version_number, NEW.title_bn, NEW.title_en, NEW.based_on_version_id, NEW.published_at)
         IS DISTINCT FROM
       (OLD.section_id, OLD.version_number, OLD.title_bn, OLD.title_en, OLD.based_on_version_id, OLD.published_at)
       OR NOT (NEW.review_state = OLD.review_state OR (OLD.review_state = 'published' AND NEW.review_state = 'superseded'))
       OR (OLD.review_state <> 'published' AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
      RAISE EXCEPTION 'section_version % is immutable', OLD.review_state USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER "section_version_immutable" BEFORE UPDATE OR DELETE ON "section_version" FOR EACH ROW EXECUTE FUNCTION catalog_section_version_guard();
--> statement-breakpoint
-- NFR6.206 / BR7.6 / BR7.7: authored fields of a lesson version in a published, superseded or
-- discarded section version never change; the U4 technical status fields may still change on a
-- published version, never on a superseded or discarded one.
CREATE FUNCTION catalog_lesson_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text;
BEGIN
  IF current_user = 'catalog_retention' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT review_state INTO parent_state FROM section_version WHERE section_version_id = OLD.section_version_id;
  IF parent_state IN ('published', 'superseded', 'discarded') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'lesson_version in a % section version is immutable', parent_state USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW.lesson_id, NEW.section_version_id, NEW.position, NEW.title_bn, NEW.title_en, NEW.body_bn, NEW.body_en, NEW.video_asset_id, NEW.link_domain_candidates, NEW.version)
         IS DISTINCT FROM
       (OLD.lesson_id, OLD.section_version_id, OLD.position, OLD.title_bn, OLD.title_en, OLD.body_bn, OLD.body_en, OLD.video_asset_id, OLD.link_domain_candidates, OLD.version)
       OR (parent_state <> 'published' AND (NEW.media_status, NEW.caption_languages, NEW.quiz_question_count)
             IS DISTINCT FROM (OLD.media_status, OLD.caption_languages, OLD.quiz_question_count)) THEN
      RAISE EXCEPTION 'lesson_version in a % section version is immutable', parent_state USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER "lesson_version_immutable" BEFORE UPDATE OR DELETE ON "lesson_version" FOR EACH ROW EXECUTE FUNCTION catalog_lesson_version_guard();
--> statement-breakpoint
-- NFR6.206 / BR6.5: ownership periods are append-only. A period is never deleted; a closed period
-- never changes; an open period may only be closed (valid_to set once, version bumped).
CREATE FUNCTION catalog_ownership_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'catalog_retention' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ownership_period rows are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.valid_to IS NOT NULL
     OR (NEW.section_id, NEW.instructor_id, NEW.valid_from, NEW.assigned_by, NEW.reason)
          IS DISTINCT FROM (OLD.section_id, OLD.instructor_id, OLD.valid_from, OLD.assigned_by, OLD.reason) THEN
    RAISE EXCEPTION 'a closed ownership period is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "ownership_period_immutable" BEFORE UPDATE OR DELETE ON "ownership_period" FOR EACH ROW EXECUTE FUNCTION catalog_ownership_period_guard();
--> statement-breakpoint
-- RD-215 (trigger fallback, INF-215): periods of one section never overlap on [valid_from, valid_to).
-- A per-section advisory lock serialises concurrent writers, and each query in the function takes a
-- fresh snapshot, so a writer that waited sees the other's committed period. The btree_gist
-- exclusion constraint replaces this only with the human's approval (Step 49).
CREATE FUNCTION catalog_ownership_period_no_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ownership_period:' || NEW.section_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM ownership_period o
    WHERE o.section_id = NEW.section_id
      AND o.section_ownership_id <> NEW.section_ownership_id
      AND tstzrange(o.valid_from, o.valid_to, '[)') && tstzrange(NEW.valid_from, NEW.valid_to, '[)')
  ) THEN
    RAISE EXCEPTION 'ownership periods of section % overlap', NEW.section_id USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ownership_period_no_overlap" AFTER INSERT OR UPDATE ON "ownership_period" FOR EACH ROW EXECUTE FUNCTION catalog_ownership_period_no_overlap();
--> statement-breakpoint
-- BR8.7: the review history is append-only.
CREATE FUNCTION catalog_section_review_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'section_review is append-only (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER "section_review_append_only" BEFORE UPDATE OR DELETE ON "section_review" FOR EACH ROW EXECUTE FUNCTION catalog_section_review_refuse_change();
--> statement-breakpoint
COMMENT ON COLUMN "course"."course_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."goal_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."title_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "course"."title_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "course"."description_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "course"."description_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "course"."cover_image_key" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."lead_instructor_id" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."list_price_poisha" IS 'data-class C1 (Public). Integer poisha.';
--> statement-breakpoint
COMMENT ON COLUMN "course"."access_duration_months" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."duration_locked_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."status" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."status_before_hidden" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."active_takedown_notice_id" IS 'data-class C2 (Internal). U11 notice ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."first_published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."last_published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."unpublished_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."retired_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."pin_rank" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."created_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "course"."updated_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."section_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."course_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."position" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."pending_position" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."structure_state" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."removal_requested_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."removed_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."live_version_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."working_version_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."first_published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."hidden_by_takedown_notice_id" IS 'data-class C2 (Internal). U11 notice ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."section_version_id" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."section_id" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."version_number" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."title_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."title_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."review_state" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."based_on_version_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."submitted_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."approved_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."superseded_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_version"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."lesson_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."section_id" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."kind" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."live_state" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."first_published_at" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."withdrawn_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."hidden_by_takedown_notice_id" IS 'data-class C2 (Internal). U11 notice ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."created_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."lesson_version_id" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."lesson_id" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."section_version_id" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."position" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."title_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."title_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."body_bn" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."body_en" IS 'data-class C1 (Public) once published; C2 (Internal) while a draft or working copy.';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."video_asset_id" IS 'data-class C1 (Public). U4 VideoAsset ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."media_status" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."caption_languages" IS 'data-class C1 (Public).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."quiz_question_count" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."link_domain_candidates" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "lesson_version"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "ownership_period"."section_ownership_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "ownership_period"."section_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "ownership_period"."instructor_id" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "ownership_period"."valid_from" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "ownership_period"."valid_to" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "ownership_period"."assigned_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "ownership_period"."reason" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "ownership_period"."version" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."section_review_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."section_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."section_version_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."action" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."from_state" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."to_state" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."actor_id" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."comment" IS 'data-class C3 (Personal). Free text; never copied into events, notifications or logs (BR12.4).';
--> statement-breakpoint
COMMENT ON COLUMN "section_review"."decided_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "blocked_domain"."blocked_domain_id" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "blocked_domain"."domain" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "blocked_domain"."created_by" IS 'data-class C3 (Personal). U1 user ID; not a foreign key (ADR-020).';
--> statement-breakpoint
COMMENT ON COLUMN "blocked_domain"."created_at" IS 'data-class C2 (Internal).';
--> statement-breakpoint
COMMENT ON COLUMN "blocked_domain"."version" IS 'data-class C2 (Internal).';
