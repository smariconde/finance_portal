ALTER TYPE "public"."ingestion_job_kind" ADD VALUE 'real_estate_location_refresh';--> statement-breakpoint
CREATE TABLE "re_address_geocodes" (
	"address_key" varchar(300) NOT NULL,
	"revision" integer NOT NULL,
	"run_id" uuid NOT NULL,
	"status" varchar(24) NOT NULL,
	"result" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_address_geocodes_address_key_revision_pk" PRIMARY KEY("address_key","revision"),
	CONSTRAINT "re_address_geocodes_revision_check" CHECK ("re_address_geocodes"."revision" > 0),
	CONSTRAINT "re_address_geocodes_status_check" CHECK ("re_address_geocodes"."status" in ('matched', 'not_found', 'number_not_matched', 'outside_capital', 'no_coordinates') and "re_address_geocodes"."result" ->> 'status' = "re_address_geocodes"."status")
);
--> statement-breakpoint
CREATE TABLE "re_geo_layer_features" (
	"release_id" uuid NOT NULL,
	"feature_key" varchar(128) NOT NULL,
	"properties" jsonb NOT NULL,
	"geometry" jsonb NOT NULL,
	"min_lon" double precision NOT NULL,
	"min_lat" double precision NOT NULL,
	"max_lon" double precision NOT NULL,
	"max_lat" double precision NOT NULL,
	CONSTRAINT "re_geo_layer_features_release_id_feature_key_pk" PRIMARY KEY("release_id","feature_key"),
	CONSTRAINT "re_geo_layer_features_box_check" CHECK ("re_geo_layer_features"."min_lon" <= "re_geo_layer_features"."max_lon" and "re_geo_layer_features"."min_lat" <= "re_geo_layer_features"."max_lat" and "re_geo_layer_features"."min_lon" >= -180 and "re_geo_layer_features"."max_lon" <= 180 and "re_geo_layer_features"."min_lat" >= -90 and "re_geo_layer_features"."max_lat" <= 90),
	CONSTRAINT "re_geo_layer_features_json_check" CHECK (jsonb_typeof("re_geo_layer_features"."properties") = 'object' and jsonb_typeof("re_geo_layer_features"."geometry") = 'array')
);
--> statement-breakpoint
CREATE TABLE "re_geo_layer_releases" (
	"release_id" uuid PRIMARY KEY NOT NULL,
	"layer_id" varchar(48) NOT NULL,
	"run_id" uuid NOT NULL,
	"content_hash" "bytea" NOT NULL,
	"feature_count" integer NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_geo_layer_releases_layer_check" CHECK ("re_geo_layer_releases"."layer_id" in ('idecor.cba-ordenanza-8256', 'cordoba.barrios')),
	CONSTRAINT "re_geo_layer_releases_count_check" CHECK ("re_geo_layer_releases"."feature_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "re_listing_locations" (
	"listing_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"listing_revision" integer NOT NULL,
	"input_hash" "bytea" NOT NULL,
	"reading_hash" "bytea" NOT NULL,
	"reading" jsonb NOT NULL,
	"precision" varchar(24) NOT NULL,
	"parcel_status" varchar(24) NOT NULL,
	"zoning_confidence" varchar(24) NOT NULL,
	"parcel_id" uuid,
	"resolved_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_listing_locations_listing_id_revision_pk" PRIMARY KEY("listing_id","revision"),
	CONSTRAINT "re_listing_locations_revision_check" CHECK ("re_listing_locations"."revision" > 0),
	CONSTRAINT "re_listing_locations_precision_check" CHECK ("re_listing_locations"."precision" in ('address_geocoded', 'portal_pin', 'address_block', 'portal_pin_shared', 'neighborhood_only', 'unlocated') and "re_listing_locations"."reading" ->> 'precision' = "re_listing_locations"."precision"),
	CONSTRAINT "re_listing_locations_parcel_status_check" CHECK ("re_listing_locations"."parcel_status" in ('matched', 'building_parcel', 'area_unverified', 'area_mismatch', 'no_parcel_at_point', 'several_parcels', 'not_located', 'pending')),
	CONSTRAINT "re_listing_locations_parcel_check" CHECK (("re_listing_locations"."parcel_id" is not null and "re_listing_locations"."parcel_status" in ('matched', 'building_parcel')) or ("re_listing_locations"."parcel_id" is null and "re_listing_locations"."parcel_status" not in ('matched', 'building_parcel'))),
	CONSTRAINT "re_listing_locations_zoning_check" CHECK ("re_listing_locations"."zoning_confidence" in ('official_query', 'official_map', 'corridor_inferred', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "re_point_parcel_lookups" (
	"point_key" varchar(32) NOT NULL,
	"revision" integer NOT NULL,
	"run_id" uuid NOT NULL,
	"parcels" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_point_parcel_lookups_point_key_revision_pk" PRIMARY KEY("point_key","revision"),
	CONSTRAINT "re_point_parcel_lookups_revision_check" CHECK ("re_point_parcel_lookups"."revision" > 0),
	CONSTRAINT "re_point_parcel_lookups_key_check" CHECK ("re_point_parcel_lookups"."point_key" ~ '^-?[0-9]{1,3}[.][0-9]{7},-?[0-9]{1,3}[.][0-9]{7}$'),
	CONSTRAINT "re_point_parcel_lookups_json_check" CHECK (jsonb_typeof("re_point_parcel_lookups"."parcels") = 'array')
);
--> statement-breakpoint
CREATE TABLE "re_zoning_queries" (
	"nomenclature" varchar(16) NOT NULL,
	"revision" integer NOT NULL,
	"query" jsonb NOT NULL,
	"consulted_on" date NOT NULL,
	"declared_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_zoning_queries_nomenclature_revision_pk" PRIMARY KEY("nomenclature","revision"),
	CONSTRAINT "re_zoning_queries_revision_check" CHECK ("re_zoning_queries"."revision" > 0),
	CONSTRAINT "re_zoning_queries_nomenclature_check" CHECK ("re_zoning_queries"."nomenclature" ~ '^[0-9]{16}$')
);
--> statement-breakpoint
ALTER TABLE "re_address_geocodes" ADD CONSTRAINT "re_address_geocodes_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_geo_layer_features" ADD CONSTRAINT "re_geo_layer_features_release_fk" FOREIGN KEY ("release_id") REFERENCES "public"."re_geo_layer_releases"("release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_geo_layer_releases" ADD CONSTRAINT "re_geo_layer_releases_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_listing_locations" ADD CONSTRAINT "re_listing_locations_listing_fk" FOREIGN KEY ("listing_id","listing_revision") REFERENCES "public"."re_listing_revisions"("listing_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_listing_locations" ADD CONSTRAINT "re_listing_locations_parcel_fk" FOREIGN KEY ("parcel_id") REFERENCES "public"."re_parcels"("parcel_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_point_parcel_lookups" ADD CONSTRAINT "re_point_parcel_lookups_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "re_geo_layer_releases_layer_idx" ON "re_geo_layer_releases" USING btree ("layer_id","available_at");--> statement-breakpoint
CREATE INDEX "re_listing_locations_parcel_idx" ON "re_listing_locations" USING btree ("parcel_id");