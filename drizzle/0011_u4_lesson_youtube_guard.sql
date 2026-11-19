-- A published lesson version's YouTube video is published content: like its body and video asset
-- it never changes once the section version is published, superseded or discarded (NFR6.206).
-- Same guard as 0005, with youtube_video_id added to the immutable columns.
CREATE OR REPLACE FUNCTION catalog_lesson_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF (NEW.lesson_id, NEW.section_version_id, NEW.position, NEW.title_bn, NEW.title_en, NEW.body_bn, NEW.body_en, NEW.video_asset_id, NEW.youtube_video_id, NEW.link_domain_candidates, NEW.version)
         IS DISTINCT FROM
       (OLD.lesson_id, OLD.section_version_id, OLD.position, OLD.title_bn, OLD.title_en, OLD.body_bn, OLD.body_en, OLD.video_asset_id, OLD.youtube_video_id, OLD.link_domain_candidates, OLD.version)
       OR (parent_state <> 'published' AND (NEW.media_status, NEW.caption_languages, NEW.quiz_question_count)
             IS DISTINCT FROM (OLD.media_status, OLD.caption_languages, OLD.quiz_question_count)) THEN
      RAISE EXCEPTION 'lesson_version in a % section version is immutable', parent_state USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
