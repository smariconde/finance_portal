CREATE TABLE "reference_dataset_releases" (
	"release_id" uuid PRIMARY KEY NOT NULL,
	"dataset_id" varchar(64) NOT NULL,
	"published_label" varchar(64),
	"parser_version" varchar(64) NOT NULL,
	"row_count" integer NOT NULL,
	"ingestion_run_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"source_id" varchar(64) NOT NULL,
	"source_document_id" varchar(256),
	"content_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_dataset_releases_valid_interval_check" CHECK ("reference_dataset_releases"."valid_to" is null or "reference_dataset_releases"."valid_from" < "reference_dataset_releases"."valid_to"),
	CONSTRAINT "reference_dataset_releases_superseded_after_available_check" CHECK ("reference_dataset_releases"."superseded_at" is null or "reference_dataset_releases"."superseded_at" > "reference_dataset_releases"."available_at"),
	CONSTRAINT "reference_dataset_releases_content_hash_check" CHECK ("reference_dataset_releases"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "reference_dataset_releases_dataset_id_check" CHECK ("reference_dataset_releases"."dataset_id" ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
	CONSTRAINT "reference_dataset_releases_row_count_check" CHECK ("reference_dataset_releases"."row_count" between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "reference_dataset_rows" (
	"release_id" uuid NOT NULL,
	"row_key" varchar(128) NOT NULL,
	"label" varchar(160) NOT NULL,
	"values" jsonb NOT NULL,
	CONSTRAINT "reference_dataset_rows_pkey" PRIMARY KEY("release_id","row_key"),
	CONSTRAINT "reference_dataset_rows_row_key_check" CHECK ("reference_dataset_rows"."row_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "reference_dataset_rows_values_check" CHECK (jsonb_typeof("reference_dataset_rows"."values") = 'object')
);
--> statement-breakpoint
ALTER TABLE "reference_dataset_releases" ADD CONSTRAINT "reference_dataset_releases_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_dataset_rows" ADD CONSTRAINT "reference_dataset_rows_release_fk" FOREIGN KEY ("release_id") REFERENCES "public"."reference_dataset_releases"("release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reference_dataset_releases_open_uidx" ON "reference_dataset_releases" USING btree ("dataset_id") WHERE "reference_dataset_releases"."valid_to" is null and "reference_dataset_releases"."superseded_at" is null;