CREATE TYPE "public"."depositary_program_status" AS ENUM('active', 'suspended', 'terminated', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."depositary_program_type" AS ENUM('cedear', 'adr', 'gdr', 'other');--> statement-breakpoint
CREATE TABLE "depositary_program_versions" (
	"depositary_program_id" uuid NOT NULL,
	"program_type" "depositary_program_type" NOT NULL,
	"depositary_security_id" uuid NOT NULL,
	"underlying_security_id" uuid NOT NULL,
	"depositary_legal_entity_id" uuid,
	"sponsor_legal_entity_id" uuid,
	"investor_scope" varchar(256),
	"status" "depositary_program_status" NOT NULL,
	"reported_underlying_symbol" varchar(32),
	"reported_underlying_isin" char(12),
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depositary_program_versions_pkey" PRIMARY KEY("depositary_program_id","valid_from"),
	CONSTRAINT "depositary_program_versions_valid_interval_check" CHECK ("depositary_program_versions"."valid_to" is null or "depositary_program_versions"."valid_from" < "depositary_program_versions"."valid_to"),
	CONSTRAINT "depositary_program_versions_superseded_after_available_check" CHECK ("depositary_program_versions"."superseded_at" is null or "depositary_program_versions"."superseded_at" > "depositary_program_versions"."available_at"),
	CONSTRAINT "depositary_program_versions_content_hash_check" CHECK ("depositary_program_versions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "depositary_program_versions_distinct_securities_check" CHECK ("depositary_program_versions"."depositary_security_id" <> "depositary_program_versions"."underlying_security_id"),
	CONSTRAINT "depositary_program_versions_isin_check" CHECK ("depositary_program_versions"."reported_underlying_isin" is null or "depositary_program_versions"."reported_underlying_isin" ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$')
);
--> statement-breakpoint
CREATE TABLE "depositary_programs" (
	"depositary_program_id" uuid PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depositary_ratios" (
	"depositary_ratio_id" uuid NOT NULL,
	"depositary_program_id" uuid NOT NULL,
	"depositary_units" numeric NOT NULL,
	"underlying_units" numeric NOT NULL,
	"announced_at" timestamp with time zone,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depositary_ratios_pkey" PRIMARY KEY("depositary_ratio_id","valid_from"),
	CONSTRAINT "depositary_ratios_valid_interval_check" CHECK ("depositary_ratios"."valid_to" is null or "depositary_ratios"."valid_from" < "depositary_ratios"."valid_to"),
	CONSTRAINT "depositary_ratios_superseded_after_available_check" CHECK ("depositary_ratios"."superseded_at" is null or "depositary_ratios"."superseded_at" > "depositary_ratios"."available_at"),
	CONSTRAINT "depositary_ratios_content_hash_check" CHECK ("depositary_ratios"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "depositary_ratios_units_check" CHECK ("depositary_ratios"."depositary_units" > 0 and "depositary_ratios"."underlying_units" > 0)
);
--> statement-breakpoint
ALTER TABLE "depositary_program_versions" ADD CONSTRAINT "depositary_program_versions_depositary_program_id_depositary_programs_depositary_program_id_fk" FOREIGN KEY ("depositary_program_id") REFERENCES "public"."depositary_programs"("depositary_program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositary_program_versions" ADD CONSTRAINT "depositary_program_versions_depositary_security_id_securities_security_id_fk" FOREIGN KEY ("depositary_security_id") REFERENCES "public"."securities"("security_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositary_program_versions" ADD CONSTRAINT "depositary_program_versions_underlying_security_id_securities_security_id_fk" FOREIGN KEY ("underlying_security_id") REFERENCES "public"."securities"("security_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositary_program_versions" ADD CONSTRAINT "depositary_program_versions_depositary_legal_entity_id_legal_entities_legal_entity_id_fk" FOREIGN KEY ("depositary_legal_entity_id") REFERENCES "public"."legal_entities"("legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositary_program_versions" ADD CONSTRAINT "depositary_program_versions_sponsor_legal_entity_id_legal_entities_legal_entity_id_fk" FOREIGN KEY ("sponsor_legal_entity_id") REFERENCES "public"."legal_entities"("legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depositary_ratios" ADD CONSTRAINT "depositary_ratios_depositary_program_id_depositary_programs_depositary_program_id_fk" FOREIGN KEY ("depositary_program_id") REFERENCES "public"."depositary_programs"("depositary_program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "depositary_program_versions_open_uidx" ON "depositary_program_versions" USING btree ("depositary_program_id") WHERE "depositary_program_versions"."valid_to" is null and "depositary_program_versions"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "depositary_program_versions_depositary_open_uidx" ON "depositary_program_versions" USING btree ("depositary_security_id") WHERE "depositary_program_versions"."valid_to" is null and "depositary_program_versions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "depositary_program_versions_underlying_idx" ON "depositary_program_versions" USING btree ("underlying_security_id");--> statement-breakpoint
CREATE INDEX "depositary_program_versions_depositary_entity_idx" ON "depositary_program_versions" USING btree ("depositary_legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "depositary_ratios_open_uidx" ON "depositary_ratios" USING btree ("depositary_program_id") WHERE "depositary_ratios"."valid_to" is null and "depositary_ratios"."superseded_at" is null;