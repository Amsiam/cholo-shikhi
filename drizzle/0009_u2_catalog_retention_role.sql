-- U2 Catalog, plan Step 50 (approved by the human on 2026-11-17): SD-207, SD-227, INF-216.
-- Expand-only and forward-only. No password or other secret is in this file.
--
-- The `catalog_retention` role. In staging and production the Ansible postgres-ha role creates it
-- (LOGIN, NOINHERIT, password in OpenBao prod/db/catalog_retention) before this migration runs, so
-- the CREATE below never executes there. On a developer or CI database, where nothing else creates
-- it, the migration creates it without LOGIN (nobody can sign in as it; only a member role can run
-- SET ROLE). The DO block tolerates a concurrent creator.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_retention') THEN
    CREATE ROLE catalog_retention NOLOGIN NOINHERIT;
  END IF;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END $$;
--> statement-breakpoint
-- Least privilege: USAGE on this schema, SELECT on what the eligibility checks read, DELETE on the
-- NFR10.201 / NFR10.202 tables only, and UPDATE of the two version pointers of a section (cleared
-- before its versions are deleted). No INSERT, no TRUNCATE, no other UPDATE, no DDL.
DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO catalog_retention', current_schema());
END $$;
--> statement-breakpoint
GRANT SELECT ON "course", "section", "subscription_plan", "subscription_plan_version_item", "practice_pack" TO catalog_retention;
--> statement-breakpoint
GRANT SELECT, DELETE ON "section_version", "lesson_version", "section_review", "ownership_period", "lesson_version_image", "catalog_image" TO catalog_retention;
--> statement-breakpoint
GRANT UPDATE ("live_version_id", "working_version_id") ON "section" TO catalog_retention;
--> statement-breakpoint
-- BR8.7 stays: the review history is append-only for every role, except that catalog_retention may
-- DELETE rows whose retention period has passed (SD-227). Updates stay refused for everyone.
CREATE OR REPLACE FUNCTION catalog_section_review_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'catalog_retention' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'section_review is append-only (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
