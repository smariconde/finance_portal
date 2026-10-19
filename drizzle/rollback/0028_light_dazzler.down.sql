-- Manual rollback for 0028_light_dazzler.sql.
-- Run only against the intended database after verifying backups and dependants.
-- A web search result is evidence behind a stored industry resolution and, when
-- accepted, behind a damodaran-industry assertion (TM-16): restoring NOT NULL
-- would have to invent a filing for it. The script refuses while any web
-- evidence exists; delete those resolutions deliberately first, or keep 0028.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "industry_resolution_evidence" WHERE "section" = 'web_search') THEN
    RAISE EXCEPTION 'web search evidence exists; remove it deliberately before rolling back 0028';
  END IF;
END
$$;
ALTER TABLE "industry_resolution_evidence" DROP CONSTRAINT "industry_resolution_evidence_filing_check";
ALTER TABLE "industry_resolution_evidence" ALTER COLUMN "document_accepted_at" SET NOT NULL;
ALTER TABLE "industry_resolution_evidence" ALTER COLUMN "accession_number" SET NOT NULL;
COMMIT;
