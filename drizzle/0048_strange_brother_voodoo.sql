CREATE TABLE "argentina_indicator_definitions" (
	"indicator_id" varchar(64) NOT NULL,
	"revision" smallint NOT NULL,
	"definition" jsonb NOT NULL,
	"content_hash" char(64) NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "argentina_indicator_definitions_pkey" PRIMARY KEY("indicator_id","revision"),
	CONSTRAINT "argentina_indicator_definitions_revision_check" CHECK ("argentina_indicator_definitions"."revision" >= 0),
	CONSTRAINT "argentina_indicator_definitions_hash_check" CHECK ("argentina_indicator_definitions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "argentina_indicator_definitions_time_check" CHECK ("argentina_indicator_definitions"."superseded_at" is null or "argentina_indicator_definitions"."superseded_at" > "argentina_indicator_definitions"."available_at")
);
--> statement-breakpoint
CREATE TABLE "argentina_indicator_observations" (
	"indicator_id" varchar(64) NOT NULL,
	"period_on" date NOT NULL,
	"revision" smallint NOT NULL,
	"value" numeric,
	"missing_reason" varchar(16),
	"source_note" varchar(8),
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"ingestion_run_id" uuid NOT NULL,
	CONSTRAINT "argentina_indicator_observations_pkey" PRIMARY KEY("indicator_id","period_on","revision"),
	CONSTRAINT "argentina_indicator_observations_revision_check" CHECK ("argentina_indicator_observations"."revision" >= 0),
	CONSTRAINT "argentina_indicator_observations_missing_check" CHECK (("argentina_indicator_observations"."value" is null and "argentina_indicator_observations"."missing_reason" in ('source_null', 'withdrawn')) or ("argentina_indicator_observations"."value" is not null and "argentina_indicator_observations"."missing_reason" is null)),
	CONSTRAINT "argentina_indicator_observations_note_check" CHECK ("argentina_indicator_observations"."source_note" is null or "argentina_indicator_observations"."source_note" in ('*', '**', 'e', 'i', 'u', '-', '.', '...', '///', 's')),
	CONSTRAINT "argentina_indicator_observations_time_check" CHECK ("argentina_indicator_observations"."superseded_at" is null or "argentina_indicator_observations"."superseded_at" > "argentina_indicator_observations"."available_at")
);
--> statement-breakpoint
ALTER TABLE "argentina_indicator_definitions" ADD CONSTRAINT "argentina_indicator_definitions_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "argentina_indicator_observations" ADD CONSTRAINT "argentina_indicator_observations_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "argentina_indicator_definitions_open_uidx" ON "argentina_indicator_definitions" USING btree ("indicator_id") WHERE "argentina_indicator_definitions"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "argentina_indicator_observations_open_uidx" ON "argentina_indicator_observations" USING btree ("indicator_id","period_on") WHERE "argentina_indicator_observations"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "argentina_indicator_observations_period_idx" ON "argentina_indicator_observations" USING btree ("indicator_id","period_on");