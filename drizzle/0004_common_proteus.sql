CREATE TYPE "public"."identifier_confidence" AS ENUM('authoritative', 'confirmed', 'candidate', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."identifier_subject_type" AS ENUM('legal_entity', 'security', 'listing');--> statement-breakpoint
CREATE TYPE "public"."legal_entity_status" AS ENUM('active', 'inactive', 'merged', 'dissolved', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."legal_entity_type" AS ENUM('operating_company', 'holding_company', 'bank', 'insurer', 'fund', 'trust', 'depositary', 'other');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'suspended', 'delisted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."listing_symbol_type" AS ENUM('ticker', 'local_code', 'vendor_symbol');--> statement-breakpoint
CREATE TYPE "public"."security_status" AS ENUM('active', 'inactive', 'converted', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."security_type" AS ENUM('common_equity', 'preferred_equity', 'depositary_receipt', 'fund_unit', 'etf_share', 'debt', 'other');--> statement-breakpoint
CREATE TABLE "identifier_assignments" (
	"identifier_assignment_id" uuid NOT NULL,
	"subject_type" "identifier_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"identifier_type" varchar(64) NOT NULL,
	"identifier_value" varchar(128) NOT NULL,
	"normalized_value" varchar(128) NOT NULL,
	"scope" varchar(256) NOT NULL,
	"issuing_authority" varchar(256),
	"confidence" "identifier_confidence" NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identifier_assignments_pkey" PRIMARY KEY("identifier_assignment_id","valid_from"),
	CONSTRAINT "identifier_assignments_valid_interval_check" CHECK ("identifier_assignments"."valid_to" is null or "identifier_assignments"."valid_from" < "identifier_assignments"."valid_to"),
	CONSTRAINT "identifier_assignments_superseded_after_available_check" CHECK ("identifier_assignments"."superseded_at" is null or "identifier_assignments"."superseded_at" > "identifier_assignments"."available_at"),
	CONSTRAINT "identifier_assignments_content_hash_check" CHECK ("identifier_assignments"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "identifier_assignments_type_check" CHECK ("identifier_assignments"."identifier_type" ~ '^[a-z0-9]+(_[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "index_memberships" (
	"index_membership_id" uuid NOT NULL,
	"index_id" varchar(64) NOT NULL,
	"security_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_memberships_pkey" PRIMARY KEY("index_membership_id","valid_from"),
	CONSTRAINT "index_memberships_valid_interval_check" CHECK ("index_memberships"."valid_to" is null or "index_memberships"."valid_from" < "index_memberships"."valid_to"),
	CONSTRAINT "index_memberships_superseded_after_available_check" CHECK ("index_memberships"."superseded_at" is null or "index_memberships"."superseded_at" > "index_memberships"."available_at"),
	CONSTRAINT "index_memberships_content_hash_check" CHECK ("index_memberships"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "index_memberships_index_id_check" CHECK ("index_memberships"."index_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"legal_entity_id" uuid PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_entity_versions" (
	"legal_entity_id" uuid NOT NULL,
	"legal_name" varchar(256) NOT NULL,
	"entity_type" "legal_entity_type" NOT NULL,
	"jurisdiction" char(2),
	"status" "legal_entity_status" NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_entity_versions_pkey" PRIMARY KEY("legal_entity_id","valid_from"),
	CONSTRAINT "legal_entity_versions_valid_interval_check" CHECK ("legal_entity_versions"."valid_to" is null or "legal_entity_versions"."valid_from" < "legal_entity_versions"."valid_to"),
	CONSTRAINT "legal_entity_versions_superseded_after_available_check" CHECK ("legal_entity_versions"."superseded_at" is null or "legal_entity_versions"."superseded_at" > "legal_entity_versions"."available_at"),
	CONSTRAINT "legal_entity_versions_content_hash_check" CHECK ("legal_entity_versions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "legal_entity_versions_jurisdiction_check" CHECK ("legal_entity_versions"."jurisdiction" is null or "legal_entity_versions"."jurisdiction" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "listing_symbols" (
	"listing_symbol_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"normalized_symbol" varchar(32) NOT NULL,
	"symbol_type" "listing_symbol_type" NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_symbols_pkey" PRIMARY KEY("listing_symbol_id","valid_from"),
	CONSTRAINT "listing_symbols_valid_interval_check" CHECK ("listing_symbols"."valid_to" is null or "listing_symbols"."valid_from" < "listing_symbols"."valid_to"),
	CONSTRAINT "listing_symbols_superseded_after_available_check" CHECK ("listing_symbols"."superseded_at" is null or "listing_symbols"."superseded_at" > "listing_symbols"."available_at"),
	CONSTRAINT "listing_symbols_content_hash_check" CHECK ("listing_symbols"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "listing_versions" (
	"listing_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"mic" char(4) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"country" char(2) NOT NULL,
	"status" "listing_status" NOT NULL,
	"primary_listing" boolean NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_versions_pkey" PRIMARY KEY("listing_id","valid_from"),
	CONSTRAINT "listing_versions_valid_interval_check" CHECK ("listing_versions"."valid_to" is null or "listing_versions"."valid_from" < "listing_versions"."valid_to"),
	CONSTRAINT "listing_versions_superseded_after_available_check" CHECK ("listing_versions"."superseded_at" is null or "listing_versions"."superseded_at" > "listing_versions"."available_at"),
	CONSTRAINT "listing_versions_content_hash_check" CHECK ("listing_versions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "listing_versions_codes_check" CHECK ("listing_versions"."mic" ~ '^[A-Z0-9]{4}$' and "listing_versions"."quote_currency" ~ '^[A-Z]{3}$' and "listing_versions"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"security_id" uuid PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_versions" (
	"security_id" uuid NOT NULL,
	"issuer_legal_entity_id" uuid NOT NULL,
	"security_type" "security_type" NOT NULL,
	"share_class" varchar(256),
	"economic_currency" char(3),
	"status" "security_status" NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_versions_pkey" PRIMARY KEY("security_id","valid_from"),
	CONSTRAINT "security_versions_valid_interval_check" CHECK ("security_versions"."valid_to" is null or "security_versions"."valid_from" < "security_versions"."valid_to"),
	CONSTRAINT "security_versions_superseded_after_available_check" CHECK ("security_versions"."superseded_at" is null or "security_versions"."superseded_at" > "security_versions"."available_at"),
	CONSTRAINT "security_versions_content_hash_check" CHECK ("security_versions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "security_versions_currency_check" CHECK ("security_versions"."economic_currency" is null or "security_versions"."economic_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "index_memberships" ADD CONSTRAINT "index_memberships_security_id_securities_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("security_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_versions" ADD CONSTRAINT "legal_entity_versions_legal_entity_id_legal_entities_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_symbols" ADD CONSTRAINT "listing_symbols_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_versions" ADD CONSTRAINT "listing_versions_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_versions" ADD CONSTRAINT "listing_versions_security_id_securities_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("security_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_versions" ADD CONSTRAINT "security_versions_security_id_securities_security_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("security_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_versions" ADD CONSTRAINT "security_versions_issuer_legal_entity_id_legal_entities_legal_entity_id_fk" FOREIGN KEY ("issuer_legal_entity_id") REFERENCES "public"."legal_entities"("legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identifier_assignments_authoritative_uidx" ON "identifier_assignments" USING btree ("identifier_type","normalized_value","scope") WHERE "identifier_assignments"."confidence" = 'authoritative' and "identifier_assignments"."valid_to" is null and "identifier_assignments"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "identifier_assignments_lookup_idx" ON "identifier_assignments" USING btree ("identifier_type","normalized_value","scope");--> statement-breakpoint
CREATE INDEX "identifier_assignments_subject_idx" ON "identifier_assignments" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "index_memberships_open_uidx" ON "index_memberships" USING btree ("index_id","security_id") WHERE "index_memberships"."valid_to" is null and "index_memberships"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "index_memberships_index_idx" ON "index_memberships" USING btree ("index_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entity_versions_open_uidx" ON "legal_entity_versions" USING btree ("legal_entity_id") WHERE "legal_entity_versions"."valid_to" is null and "legal_entity_versions"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_symbols_open_uidx" ON "listing_symbols" USING btree ("listing_id","symbol_type") WHERE "listing_symbols"."valid_to" is null and "listing_symbols"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "listing_symbols_lookup_idx" ON "listing_symbols" USING btree ("normalized_symbol","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_versions_open_uidx" ON "listing_versions" USING btree ("listing_id") WHERE "listing_versions"."valid_to" is null and "listing_versions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "listing_versions_venue_idx" ON "listing_versions" USING btree ("mic","security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "security_versions_open_uidx" ON "security_versions" USING btree ("security_id") WHERE "security_versions"."valid_to" is null and "security_versions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "security_versions_issuer_idx" ON "security_versions" USING btree ("issuer_legal_entity_id");