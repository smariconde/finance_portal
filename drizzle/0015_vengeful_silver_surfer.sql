CREATE TABLE "ingestion_refresh_state" (
	"source_id" varchar(64) NOT NULL,
	"dataset_id" varchar(128) NOT NULL,
	"subject_key" varchar(128) NOT NULL,
	"watermark_accepted_at" timestamp with time zone NOT NULL,
	"watermark_accession" varchar(64) NOT NULL,
	"form_selection_version" varchar(64) NOT NULL,
	"probe_version" varchar(64) NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"last_changed_at" timestamp with time zone NOT NULL,
	"probe_run_id" uuid NOT NULL,
	"refresh_run_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingestion_refresh_state_pkey" PRIMARY KEY("source_id","dataset_id","subject_key"),
	CONSTRAINT "ingestion_refresh_state_accession_check" CHECK ("ingestion_refresh_state"."watermark_accession" ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
	CONSTRAINT "ingestion_refresh_state_timeline_check" CHECK ("ingestion_refresh_state"."last_changed_at" <= "ingestion_refresh_state"."last_checked_at" and "ingestion_refresh_state"."updated_at" >= "ingestion_refresh_state"."last_checked_at")
);
--> statement-breakpoint
ALTER TABLE "ingestion_refresh_state" ADD CONSTRAINT "ingestion_refresh_state_probe_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("probe_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_refresh_state" ADD CONSTRAINT "ingestion_refresh_state_refresh_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("refresh_run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_refresh_state_dataset_idx" ON "ingestion_refresh_state" USING btree ("source_id","dataset_id","last_checked_at");