-- Quiz questions become versioned with their lesson, like its text (NFR6.206): a working copy has
-- its own questions, and a published, superseded or discarded version's questions never change.
-- Existing questions belong to the lesson's live version; any question without one is dropped.
ALTER TABLE "quiz_question" DROP CONSTRAINT "quiz_question_position_uq";--> statement-breakpoint
ALTER TABLE "quiz_question" ADD COLUMN "lesson_version_id" uuid;--> statement-breakpoint
UPDATE "quiz_question" q SET "lesson_version_id" = lv."lesson_version_id"
  FROM "lesson" l
  JOIN "section" s ON s."section_id" = l."section_id"
  JOIN "lesson_version" lv ON lv."section_version_id" = s."live_version_id" AND lv."lesson_id" = l."lesson_id"
  WHERE q."lesson_id" = l."lesson_id";--> statement-breakpoint
DELETE FROM "quiz_question" WHERE "lesson_version_id" IS NULL;--> statement-breakpoint
ALTER TABLE "quiz_question" ALTER COLUMN "lesson_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_question" ADD CONSTRAINT "quiz_question_lesson_version_id_lesson_version_lesson_version_id_fk" FOREIGN KEY ("lesson_version_id") REFERENCES "public"."lesson_version"("lesson_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_question_lesson_idx" ON "quiz_question" USING btree ("lesson_id");--> statement-breakpoint
ALTER TABLE "quiz_question" ADD CONSTRAINT "quiz_question_version_position_uq" UNIQUE("lesson_version_id","position");--> statement-breakpoint
COMMENT ON COLUMN "quiz_question"."lesson_version_id" IS 'data-class C1 (Public).';--> statement-breakpoint
CREATE FUNCTION catalog_quiz_question_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text;
BEGIN
  IF current_user = 'catalog_retention' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT sv.review_state INTO parent_state
    FROM lesson_version lv JOIN section_version sv ON sv.section_version_id = lv.section_version_id
    WHERE lv.lesson_version_id = OLD.lesson_version_id;
  IF parent_state IN ('published', 'superseded', 'discarded') THEN
    RAISE EXCEPTION 'quiz_question in a % section version is immutable', parent_state USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint
CREATE TRIGGER "quiz_question_immutable" BEFORE UPDATE OR DELETE ON "quiz_question" FOR EACH ROW EXECUTE FUNCTION catalog_quiz_question_guard();
