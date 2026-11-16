CREATE TABLE "company_logo_assets" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"provider_symbol" varchar(16) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"parser_version" varchar(64) NOT NULL,
	"png" "bytea",
	"content_hash" "bytea",
	"fetched_at" timestamp with time zone,
	"claim_token" uuid,
	"retry_at" timestamp with time zone NOT NULL,
	CONSTRAINT "company_logo_assets_symbol_check" CHECK ("company_logo_assets"."provider_symbol" ~ '^[A-Z0-9][A-Z0-9.-]{0,15}$'),
	CONSTRAINT "company_logo_assets_payload_check" CHECK (("company_logo_assets"."png" is null and "company_logo_assets"."content_hash" is null and "company_logo_assets"."fetched_at" is null) or ("company_logo_assets"."png" is not null and octet_length("company_logo_assets"."png") between 1 and 262144 and "company_logo_assets"."content_hash" is not null and octet_length("company_logo_assets"."content_hash") = 32 and "company_logo_assets"."fetched_at" is not null and "company_logo_assets"."claim_token" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "company_logo_assets_source_symbol_uidx" ON "company_logo_assets" USING btree ("source_id","provider_symbol");