CREATE TABLE "macro_series" (
	"series_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "macro_series_series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"series_key" varchar(80) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"external_id" varchar(16) NOT NULL,
	"basis_frequency" varchar(16),
	"basis_unit" varchar(120),
	"basis_currency" varchar(8),
	CONSTRAINT "macro_series_key_check" CHECK ("macro_series"."series_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*:[0-9]{1,6}$'),
	CONSTRAINT "macro_series_basis_check" CHECK (("macro_series"."basis_frequency" is null and "macro_series"."basis_unit" is null and "macro_series"."basis_currency" is null) or ("macro_series"."basis_frequency" in ('daily', 'monthly', 'quarterly') and "macro_series"."basis_unit" is not null and "macro_series"."basis_currency" in ('ML', 'ME', 'MEyML', 'ARS', 'USD')))
);
--> statement-breakpoint
CREATE TABLE "macro_series_definitions" (
	"definition_id" uuid PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"description" varchar(300) NOT NULL,
	"category" varchar(120) NOT NULL,
	"series_type" varchar(120) NOT NULL,
	"frequency" varchar(16) NOT NULL,
	"unit" varchar(120) NOT NULL,
	"currency_code" varchar(8) NOT NULL,
	"first_reported_on" date NOT NULL,
	"methodology" text,
	"parser_version" varchar(64) NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "macro_series_definitions_valid_interval_check" CHECK ("macro_series_definitions"."valid_to" is null or "macro_series_definitions"."valid_from" < "macro_series_definitions"."valid_to"),
	CONSTRAINT "macro_series_definitions_superseded_after_available_check" CHECK ("macro_series_definitions"."superseded_at" is null or "macro_series_definitions"."superseded_at" > "macro_series_definitions"."available_at"),
	CONSTRAINT "macro_series_definitions_content_hash_check" CHECK ("macro_series_definitions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "macro_series_definitions_frequency_check" CHECK ("macro_series_definitions"."frequency" in ('daily', 'monthly', 'quarterly')),
	CONSTRAINT "macro_series_definitions_currency_check" CHECK ("macro_series_definitions"."currency_code" in ('ML', 'ME', 'MEyML', 'ARS', 'USD')),
	CONSTRAINT "macro_series_definitions_methodology_check" CHECK ("macro_series_definitions"."methodology" is null or char_length("macro_series_definitions"."methodology") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "macro_series_observations" (
	"series_id" integer NOT NULL,
	"period_on" date NOT NULL,
	"revision" smallint NOT NULL,
	"value" numeric,
	"withdrawn" boolean NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "macro_series_observations_pkey" PRIMARY KEY("series_id","period_on","revision"),
	CONSTRAINT "macro_series_observations_revision_check" CHECK ("macro_series_observations"."revision" >= 0),
	CONSTRAINT "macro_series_observations_withdrawn_check" CHECK ("macro_series_observations"."withdrawn" = ("macro_series_observations"."value" is null)),
	CONSTRAINT "macro_series_observations_superseded_check" CHECK ("macro_series_observations"."superseded_at" is null or "macro_series_observations"."superseded_at" > "macro_series_observations"."available_at")
);
--> statement-breakpoint
ALTER TABLE "macro_series_definitions" ADD CONSTRAINT "macro_series_definitions_series_fk" FOREIGN KEY ("series_id") REFERENCES "public"."macro_series"("series_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_series_definitions" ADD CONSTRAINT "macro_series_definitions_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_series_observations" ADD CONSTRAINT "macro_series_observations_series_fk" FOREIGN KEY ("series_id") REFERENCES "public"."macro_series"("series_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_series_observations" ADD CONSTRAINT "macro_series_observations_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "macro_series_key_uidx" ON "macro_series" USING btree ("series_key");--> statement-breakpoint
CREATE UNIQUE INDEX "macro_series_source_external_uidx" ON "macro_series" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "macro_series_definitions_open_uidx" ON "macro_series_definitions" USING btree ("series_id") WHERE "macro_series_definitions"."valid_to" is null and "macro_series_definitions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "macro_series_definitions_series_idx" ON "macro_series_definitions" USING btree ("series_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "macro_series_observations_open_uidx" ON "macro_series_observations" USING btree ("series_id","period_on") WHERE "macro_series_observations"."superseded_at" is null;