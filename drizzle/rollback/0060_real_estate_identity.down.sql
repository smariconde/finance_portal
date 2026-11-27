-- Manual rollback of 0060. Captured listings cannot be downloaded again: the
-- portals change and remove what they published. Refuse while any revision
-- exists, so a rollback never discards observations by accident.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "re_listing_revisions") THEN
    RAISE EXCEPTION 're_listing_revisions holds captured listings; export them deliberately before rolling back 0060';
  END IF;
END
$$;
DROP TABLE "re_listing_revisions";
DROP TABLE "re_listings";
DROP TABLE "re_property_parcel_links";
DROP TABLE "re_properties";
DROP TABLE "re_parcel_lineage";
DROP TABLE "re_parcel_versions";
DROP TABLE "re_parcels";
COMMIT;
