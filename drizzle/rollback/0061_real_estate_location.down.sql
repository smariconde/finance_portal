-- Manual rollback of 0061. The layer releases can be downloaded again, but the
-- Georef and IDECOR answers and the owner's zoning queries cannot be rebuilt
-- as they were: refuse while any location reading or zoning query exists, and
-- while a location job exists, so a rollback never discards them by accident.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "re_listing_locations")
    OR EXISTS (SELECT 1 FROM "re_zoning_queries") THEN
    RAISE EXCEPTION 'location readings or zoning queries exist; export them deliberately before rolling back 0061';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ingestion_jobs" WHERE "job_kind" = 'real_estate_location_refresh'
  ) THEN
    RAISE EXCEPTION 'a real estate location job exists; resolve its records deliberately before rolling back 0061';
  END IF;
END
$$;
DROP TABLE "re_listing_locations";
DROP TABLE "re_zoning_queries";
DROP TABLE "re_point_parcel_lookups";
DROP TABLE "re_address_geocodes";
DROP TABLE "re_geo_layer_features";
DROP TABLE "re_geo_layer_releases";
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_kind" TYPE text;
DROP TYPE "public"."ingestion_job_kind";
CREATE TYPE "public"."ingestion_job_kind" AS ENUM ('sec_companyfacts_backfill', 'sec_companyfacts_refresh', 'yahoo_prices_refresh', 'argentina_data_refresh', 'alpha_vantage_consensus_refresh', 'market_calendar_refresh');
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_kind" TYPE "public"."ingestion_job_kind" USING "job_kind"::"public"."ingestion_job_kind";
COMMIT;
