-- U2 Catalog, plan Step 49 (approved by the human on 2026-11-17): RD-215 / INF-215.
-- Expand-only and forward-only. `btree_gist` is a trusted contrib extension, so the migration owner
-- creates it without superuser; it is installed once per database, in `public`, and stays installed
-- (harmless) if a later release no longer uses it. The DO block tolerates a concurrent creator.
-- Migration-lint (CI-203, deferred with CI) allows CREATE EXTENSION for this one name only.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END $$;
--> statement-breakpoint
-- RD-215: the periods of one section never overlap on [valid_from, valid_to). The database now
-- enforces it with an exclusion constraint; the 0005 constraint trigger stays as a second layer.
-- Existing rows already satisfy the rule (the trigger has enforced it since 0005).
ALTER TABLE "ownership_period" ADD CONSTRAINT "ownership_period_no_overlap_ex"
  EXCLUDE USING gist ("section_id" WITH =, tstzrange("valid_from", "valid_to", '[)') WITH &&);
