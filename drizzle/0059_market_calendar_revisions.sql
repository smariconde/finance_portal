ALTER TYPE "public"."ingestion_job_kind" ADD VALUE 'market_calendar_refresh';--> statement-breakpoint
CREATE TABLE "calendar_event_revisions" (
	"event_key" varchar(128) NOT NULL,
	"revision" integer NOT NULL,
	"run_id" uuid NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "calendar_event_revisions_event_key_revision_pk" PRIMARY KEY("event_key","revision"),
	CONSTRAINT "calendar_event_revisions_positive" CHECK ("calendar_event_revisions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "calendar_event_revisions" ADD CONSTRAINT "calendar_event_revisions_run_id_ingestion_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_revisions_run_idx" ON "calendar_event_revisions" USING btree ("run_id");