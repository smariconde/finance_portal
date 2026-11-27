CREATE TABLE "re_listing_revisions" (
	"listing_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"capture_contract" varchar(32) NOT NULL,
	"revision_rule" varchar(32) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"page_kind" varchar(16) NOT NULL,
	"parse_basis" varchar(16) NOT NULL,
	"status" varchar(8) NOT NULL,
	"removal_evidence" varchar(16),
	"detail_seen" boolean NOT NULL,
	"content_hash" "bytea" NOT NULL,
	"operation" varchar(8) NOT NULL,
	"property_type" varchar(16) NOT NULL,
	"price_status" varchar(16) NOT NULL,
	"price_amount" numeric,
	"price_currency" char(3),
	"expenses_amount" numeric,
	"expenses_currency" char(3),
	"covered_area_m2" numeric,
	"total_area_m2" numeric,
	"land_area_m2" numeric,
	"rooms" smallint,
	"bedrooms" smallint,
	"bathrooms" smallint,
	"parking_spaces" smallint,
	"age_years" smallint,
	"floor" smallint,
	"amenities" varchar(16)[] NOT NULL,
	"condition" varchar(16) NOT NULL,
	"legal_flags" varchar(16)[] NOT NULL,
	"address_declared" varchar(300),
	"neighborhood" varchar(120),
	"latitude" numeric,
	"longitude" numeric,
	"agency" varchar(200),
	"published_at" date,
	"description_simhash" char(16),
	"photo_dhashes" char(16)[] NOT NULL,
	"photo_count" smallint NOT NULL,
	CONSTRAINT "re_listing_revisions_listing_id_revision_pk" PRIMARY KEY("listing_id","revision"),
	CONSTRAINT "re_listing_revisions_revision_check" CHECK ("re_listing_revisions"."revision" > 0),
	CONSTRAINT "re_listing_revisions_closed_sets_check" CHECK ("re_listing_revisions"."page_kind" in ('listing_detail', 'search_result') and "re_listing_revisions"."parse_basis" in ('json_ld', 'embedded_state', 'dom') and "re_listing_revisions"."operation" in ('sale', 'rent') and "re_listing_revisions"."property_type" in ('house', 'apartment', 'ph', 'land', 'parking', 'office', 'retail') and "re_listing_revisions"."condition" in ('new', 'good', 'to_renovate', 'unknown')),
	CONSTRAINT "re_listing_revisions_status_check" CHECK (("re_listing_revisions"."status" = 'active' and "re_listing_revisions"."removal_evidence" is null) or ("re_listing_revisions"."status" = 'removed' and "re_listing_revisions"."removal_evidence" is not null and "re_listing_revisions"."removal_evidence" in ('portal_finished', 'http_404'))),
	CONSTRAINT "re_listing_revisions_price_check" CHECK (("re_listing_revisions"."price_status" = 'published' and "re_listing_revisions"."price_amount" is not null and "re_listing_revisions"."price_amount" > 0 and "re_listing_revisions"."price_currency" is not null and "re_listing_revisions"."price_currency" in ('USD', 'ARS')) or ("re_listing_revisions"."price_status" = 'on_request' and "re_listing_revisions"."price_amount" is null and "re_listing_revisions"."price_currency" is null)),
	CONSTRAINT "re_listing_revisions_expenses_check" CHECK (("re_listing_revisions"."expenses_amount" is null and "re_listing_revisions"."expenses_currency" is null) or ("re_listing_revisions"."expenses_amount" is not null and "re_listing_revisions"."expenses_amount" > 0 and "re_listing_revisions"."expenses_currency" is not null and "re_listing_revisions"."expenses_currency" in ('USD', 'ARS'))),
	CONSTRAINT "re_listing_revisions_areas_check" CHECK (coalesce("re_listing_revisions"."covered_area_m2", 1) > 0 and coalesce("re_listing_revisions"."total_area_m2", 1) > 0 and coalesce("re_listing_revisions"."land_area_m2", 1) > 0),
	CONSTRAINT "re_listing_revisions_counts_check" CHECK (coalesce("re_listing_revisions"."rooms", 1) between 1 and 99 and coalesce("re_listing_revisions"."bedrooms", 0) between 0 and 99 and coalesce("re_listing_revisions"."bathrooms", 0) between 0 and 99 and coalesce("re_listing_revisions"."parking_spaces", 0) between 0 and 999 and coalesce("re_listing_revisions"."age_years", 0) between 0 and 300 and coalesce("re_listing_revisions"."floor", 0) between -5 and 200),
	CONSTRAINT "re_listing_revisions_amenities_check" CHECK ("re_listing_revisions"."amenities" <@ array['pool', 'gym', 'sum', 'security', 'grill', 'elevator', 'balcony', 'garden']::varchar[]),
	CONSTRAINT "re_listing_revisions_legal_flags_check" CHECK ("re_listing_revisions"."legal_flags" <@ array['credit_eligible', 'deed', 'boleto_only', 'succession', 'possession']::varchar[]),
	CONSTRAINT "re_listing_revisions_coordinates_check" CHECK (("re_listing_revisions"."latitude" is null and "re_listing_revisions"."longitude" is null) or ("re_listing_revisions"."latitude" is not null and "re_listing_revisions"."longitude" is not null and "re_listing_revisions"."latitude" between -90 and 90 and "re_listing_revisions"."longitude" between -180 and 180)),
	CONSTRAINT "re_listing_revisions_hashes_check" CHECK (("re_listing_revisions"."description_simhash" is null or "re_listing_revisions"."description_simhash" ~ '^[0-9a-f]{16}$') and cardinality("re_listing_revisions"."photo_dhashes") <= 5 and "re_listing_revisions"."photo_count" >= cardinality("re_listing_revisions"."photo_dhashes"))
);
--> statement-breakpoint
CREATE TABLE "re_listings" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"source_id" varchar(32) NOT NULL,
	"external_id" varchar(64) NOT NULL,
	"canonical_url" varchar(512) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_listings_source_check" CHECK ("re_listings"."source_id" in ('remax-ar', 'zonaprop', 'argenprop', 'mercadolibre-inmuebles')),
	CONSTRAINT "re_listings_seen_check" CHECK ("re_listings"."last_seen_at" >= "re_listings"."first_seen_at"),
	CONSTRAINT "re_listings_url_check" CHECK ("re_listings"."canonical_url" like 'https://%' and position('?' in "re_listings"."canonical_url") = 0 and position('#' in "re_listings"."canonical_url") = 0)
);
--> statement-breakpoint
CREATE TABLE "re_parcel_lineage" (
	"predecessor_parcel_id" uuid NOT NULL,
	"successor_parcel_id" uuid NOT NULL,
	"event" varchar(16) NOT NULL,
	"effective_on" date NOT NULL,
	CONSTRAINT "re_parcel_lineage_predecessor_parcel_id_successor_parcel_id_pk" PRIMARY KEY("predecessor_parcel_id","successor_parcel_id"),
	CONSTRAINT "re_parcel_lineage_distinct_check" CHECK ("re_parcel_lineage"."predecessor_parcel_id" <> "re_parcel_lineage"."successor_parcel_id"),
	CONSTRAINT "re_parcel_lineage_event_check" CHECK ("re_parcel_lineage"."event" in ('subdivision', 'merge'))
);
--> statement-breakpoint
CREATE TABLE "re_parcel_versions" (
	"parcel_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"provincial_nomenclature" varchar(40),
	"municipal_nomenclature" varchar(32),
	"land_area_m2" numeric,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"ended_by" varchar(16),
	"closed_observed_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_parcel_versions_parcel_id_version_pk" PRIMARY KEY("parcel_id","version"),
	CONSTRAINT "re_parcel_versions_version_check" CHECK ("re_parcel_versions"."version" > 0),
	CONSTRAINT "re_parcel_versions_nomenclature_check" CHECK ("re_parcel_versions"."provincial_nomenclature" is not null or "re_parcel_versions"."municipal_nomenclature" is not null),
	CONSTRAINT "re_parcel_versions_area_check" CHECK ("re_parcel_versions"."land_area_m2" is null or "re_parcel_versions"."land_area_m2" > 0),
	CONSTRAINT "re_parcel_versions_closed_check" CHECK (("re_parcel_versions"."valid_to" is null) = ("re_parcel_versions"."ended_by" is null) and ("re_parcel_versions"."valid_to" is null) = ("re_parcel_versions"."closed_observed_at" is null)),
	CONSTRAINT "re_parcel_versions_ended_by_check" CHECK ("re_parcel_versions"."ended_by" is null or "re_parcel_versions"."ended_by" in ('subdivision', 'merge', 'correction')),
	CONSTRAINT "re_parcel_versions_validity_check" CHECK ("re_parcel_versions"."valid_to" is null or "re_parcel_versions"."valid_to" > "re_parcel_versions"."valid_from"),
	CONSTRAINT "re_parcel_versions_closed_observed_check" CHECK ("re_parcel_versions"."closed_observed_at" is null or "re_parcel_versions"."closed_observed_at" >= "re_parcel_versions"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "re_parcels" (
	"parcel_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "re_properties" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"property_type" varchar(16) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_properties_type_check" CHECK ("re_properties"."property_type" in ('house', 'apartment', 'ph', 'land', 'parking', 'office', 'retail'))
);
--> statement-breakpoint
CREATE TABLE "re_property_parcel_links" (
	"property_id" uuid NOT NULL,
	"revision" smallint NOT NULL,
	"parcel_id" uuid NOT NULL,
	"basis" varchar(24) NOT NULL,
	"confidence" varchar(16) NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "re_property_parcel_links_property_id_revision_pk" PRIMARY KEY("property_id","revision"),
	CONSTRAINT "re_property_parcel_links_revision_check" CHECK ("re_property_parcel_links"."revision" > 0),
	CONSTRAINT "re_property_parcel_links_confidence_check" CHECK (("re_property_parcel_links"."basis" = 'owner_declared' and "re_property_parcel_links"."confidence" = 'confirmed') or ("re_property_parcel_links"."basis" = 'address_geocoded' and "re_property_parcel_links"."confidence" = 'probable') or ("re_property_parcel_links"."basis" = 'portal_pin' and "re_property_parcel_links"."confidence" = 'possible')),
	CONSTRAINT "re_property_parcel_links_superseded_check" CHECK ("re_property_parcel_links"."superseded_at" is null or "re_property_parcel_links"."superseded_at" > "re_property_parcel_links"."available_at")
);
--> statement-breakpoint
ALTER TABLE "re_listing_revisions" ADD CONSTRAINT "re_listing_revisions_listing_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."re_listings"("listing_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_parcel_lineage" ADD CONSTRAINT "re_parcel_lineage_predecessor_fk" FOREIGN KEY ("predecessor_parcel_id") REFERENCES "public"."re_parcels"("parcel_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_parcel_lineage" ADD CONSTRAINT "re_parcel_lineage_successor_fk" FOREIGN KEY ("successor_parcel_id") REFERENCES "public"."re_parcels"("parcel_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_parcel_versions" ADD CONSTRAINT "re_parcel_versions_parcel_fk" FOREIGN KEY ("parcel_id") REFERENCES "public"."re_parcels"("parcel_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_property_parcel_links" ADD CONSTRAINT "re_property_parcel_links_property_fk" FOREIGN KEY ("property_id") REFERENCES "public"."re_properties"("property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_property_parcel_links" ADD CONSTRAINT "re_property_parcel_links_parcel_fk" FOREIGN KEY ("parcel_id") REFERENCES "public"."re_parcels"("parcel_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "re_listing_revisions_observed_idx" ON "re_listing_revisions" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "re_listings_source_external_uidx" ON "re_listings" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "re_parcel_lineage_successor_idx" ON "re_parcel_lineage" USING btree ("successor_parcel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "re_parcel_versions_open_uidx" ON "re_parcel_versions" USING btree ("parcel_id") WHERE "re_parcel_versions"."valid_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "re_parcel_versions_open_provincial_uidx" ON "re_parcel_versions" USING btree ("provincial_nomenclature") WHERE "re_parcel_versions"."valid_to" is null and "re_parcel_versions"."provincial_nomenclature" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "re_parcel_versions_open_municipal_uidx" ON "re_parcel_versions" USING btree ("municipal_nomenclature") WHERE "re_parcel_versions"."valid_to" is null and "re_parcel_versions"."municipal_nomenclature" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "re_property_parcel_links_open_uidx" ON "re_property_parcel_links" USING btree ("property_id") WHERE "re_property_parcel_links"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "re_property_parcel_links_parcel_idx" ON "re_property_parcel_links" USING btree ("parcel_id");